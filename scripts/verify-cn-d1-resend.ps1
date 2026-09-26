# CN-D1 Step 7 verification — Path B (local, read-only, no PII).
#
# Prompts once for MARKETING_RESEND_API_KEY via Read-Host -AsSecureString.
# The key lives in a SecureString + a local variable only for the
# duration of this script, is never printed, never logged, never
# written to disk, never included in the JSON result.
#
# Read-only against Resend: only GET requests are made. No Contacts,
# Segments, Topics or Broadcasts are created, updated or deleted.
#
# Compact PII-free result → $env:TEMP\cn-d1-verify.json.
# The result contains only booleans, counts, expected UUIDs and
# topic *names* (like "site:mtg"). Never emails, first/last names,
# raw user_ids, tokens or the API key.

$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = `
    [System.Net.SecurityProtocolType]::Tls12

# ── Expected state (from Supabase truth, Step 7 pre-flight) ────────
$CN_SEGMENT_ID  = '72e29c78-c646-49c1-a3a0-cf099fcd7fa1'  # Collector Network Contacts
$GENERAL_SEG_ID = 'd2a83a27-1b52-48d5-a57b-723ff9b26369'  # PokePrices legacy segment
$YGO_TOPIC_ID   = 'ea9c424b-6e37-4647-a874-a183da5aa41a'
$NET_TOPIC_ID   = 'd08c3731-ff32-4f3f-871a-b2bd08146fd1'

# The 7 managed contacts and their expected topic subscription per
# Supabase collector_marketing_preferences. 'absent' means CN-D1
# did NOT write this topic for this contact (no preference row).
# Resend still enumerates the topic in GET /contacts/{id}/topics
# with its default_subscription (opt_out). Verification rule:
# 'absent' cells must NOT be 'opt_in' — they must be 'opt_out' or
# missing entirely.
$Expected = @(
    @{ id = '23c4aa40-74c3-4a16-ae32-e3c001b79785'; ygo = 'opt_in';  net = 'absent'  }
    @{ id = '3511d7f3-5780-4f48-88f1-cded33b56bef'; ygo = 'opt_in';  net = 'opt_in'  }
    @{ id = '5c3a2324-e03c-4172-aaec-a9d620d9419e'; ygo = 'absent';  net = 'opt_in'  }
    @{ id = '5e97c0cb-e020-484c-8816-06de0de515fc'; ygo = 'opt_in';  net = 'opt_out' }
    @{ id = '973e57f5-1274-4563-b316-9c402c704a2f'; ygo = 'opt_out'; net = 'opt_in'  }
    @{ id = 'aab07ba8-b6f2-4f2d-aace-d49bfd058a71'; ygo = 'opt_out'; net = 'absent'  }
    @{ id = 'f05fd759-9711-4d03-a0db-001eb0207cb7'; ygo = 'opt_out'; net = 'opt_in'  }
    # 8th managed contact — added post-CN-D1-backfill when its
    # user gained their first marketing preference row via
    # /email-preferences. Kept in this drift-check baseline as of
    # CN-D1 close (2026-09-26). Update this row if the account's
    # preference state legitimately changes.
    @{ id = 'f21fc88b-acf3-4a03-ad8c-8bfd51f9866a'; ygo = 'opt_out'; net = 'opt_in' }
)

# ── Prompt for key (never echoed / never persisted) ─────────────────
$sec = Read-Host -AsSecureString `
    -Prompt 'MARKETING_RESEND_API_KEY (read-only, session-only)'
$key = [System.Net.NetworkCredential]::new('', $sec).Password
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host 'empty key; aborting'
    return
}
$H = @{ Authorization = "Bearer $key" }

function Get-Resend([string]$url) {
    Invoke-RestMethod -Uri $url -Headers $H -Method Get `
        -ContentType 'application/json'
}

$driftReasons  = @()
$fatalReason   = $null

try {
    # ── Global: segments ────────────────────────────────────────
    $segs = Get-Resend 'https://api.resend.com/segments'
    $segIds = @()
    foreach ($s in $segs.data) { $segIds += $s.id }
    $general_present = $segIds -contains $GENERAL_SEG_ID
    $cn_present      = $segIds -contains $CN_SEGMENT_ID

    # ── Global: topics ──────────────────────────────────────────
    $tops = Get-Resend 'https://api.resend.com/topics?limit=100'
    $ygoTop = @($tops.data | Where-Object { $_.id -eq $YGO_TOPIC_ID })
    $netTop = @($tops.data | Where-Object { $_.id -eq $NET_TOPIC_ID })
    $expected_topics_present = `
        ($ygoTop.Count -eq 1) `
        -and ($netTop.Count -eq 1) `
        -and ($ygoTop[0].default_subscription -eq 'opt_out') `
        -and ($netTop[0].default_subscription -eq 'opt_out')

    # No CN-D1-created MTG / Pokemon / One Piece / Lorcana topics.
    # PokePrices legacy topics (there were none per Gate A, but
    # tolerated by name if they appear) are NOT flagged.
    $unexpected_cn = @()
    foreach ($t in $tops.data) {
        if ($t.name -match '^site:(mtg|pokemon|onepiece|lorcana)$') {
            $unexpected_cn += $t.name
        }
    }

    # ── Global: broadcasts ──────────────────────────────────────
    $bcs = Get-Resend 'https://api.resend.com/broadcasts'
    $untitledCount = @($bcs.data | Where-Object { $_.name -eq 'Untitled' }).Count
    $untitled_drafts_present = ($untitledCount -ge 2)
    $bc_total = @($bcs.data).Count

    # ── Global: total contacts ──────────────────────────────────
    $allContacts = Get-Resend 'https://api.resend.com/contacts?limit=100'
    $total_contacts_in_workspace = @($allContacts.data).Count

    # ── Per-contact ─────────────────────────────────────────────
    $contactsFound     = 0
    $segMembershipOk   = 0
    $ygoMatches        = 0
    $netMatches        = 0
    $missingDefaultOk  = 0
    $globalUnsubCount  = 0
    $absentCells       = 0

    foreach ($e in $Expected) {
        $cid = $e.id
        if ($e.ygo -eq 'absent') { $absentCells++ }
        if ($e.net -eq 'absent') { $absentCells++ }

        # Contact exists + not globally unsubscribed.
        try {
            $c = Get-Resend "https://api.resend.com/contacts/$cid"
            $contactsFound++
            if ($c.unsubscribed -eq $true) {
                $globalUnsubCount++
                $driftReasons += "contact_${cid}:globally_unsubscribed"
            }
        }
        catch {
            $driftReasons += "contact_${cid}:not_found"
            continue
        }

        # Segment membership.
        try {
            $cs = Get-Resend "https://api.resend.com/contacts/$cid/segments"
            $cSegs = @($cs.data | ForEach-Object { $_.id })
            if ($cSegs -contains $CN_SEGMENT_ID) {
                $segMembershipOk++
            }
            else {
                $driftReasons += "contact_${cid}:missing_cn_segment"
            }
        }
        catch {
            $driftReasons += "contact_${cid}:segments_fetch_error"
        }

        # Topic subscriptions.
        try {
            $ct = Get-Resend "https://api.resend.com/contacts/$cid/topics"
            $topMap = @{}
            foreach ($t in $ct.data) { $topMap[$t.id] = $t.subscription }

            # site:ygo topic.
            $ygoActual = $null
            if ($topMap.ContainsKey($YGO_TOPIC_ID)) { $ygoActual = $topMap[$YGO_TOPIC_ID] }
            if ($e.ygo -eq 'absent') {
                if ($ygoActual -ne 'opt_in') {
                    $missingDefaultOk++
                    $ygoMatches++
                }
                else {
                    $driftReasons += "contact_${cid}:ygo_fabricated_opt_in"
                }
            }
            else {
                if ($ygoActual -eq $e.ygo) {
                    $ygoMatches++
                }
                else {
                    $driftReasons += "contact_${cid}:ygo_expected_$($e.ygo)_actual_$ygoActual"
                }
            }

            # network topic.
            $netActual = $null
            if ($topMap.ContainsKey($NET_TOPIC_ID)) { $netActual = $topMap[$NET_TOPIC_ID] }
            if ($e.net -eq 'absent') {
                if ($netActual -ne 'opt_in') {
                    $missingDefaultOk++
                    $netMatches++
                }
                else {
                    $driftReasons += "contact_${cid}:network_fabricated_opt_in"
                }
            }
            else {
                if ($netActual -eq $e.net) {
                    $netMatches++
                }
                else {
                    $driftReasons += "contact_${cid}:network_expected_$($e.net)_actual_$netActual"
                }
            }
        }
        catch {
            $driftReasons += "contact_${cid}:topics_fetch_error"
        }
    }

    $overall_pass = (
        ($contactsFound -eq $Expected.Count) `
        -and ($segMembershipOk -eq $Expected.Count) `
        -and ($ygoMatches -eq $Expected.Count) `
        -and ($netMatches -eq $Expected.Count) `
        -and ($missingDefaultOk -eq $absentCells) `
        -and ($globalUnsubCount -eq 0) `
        -and $general_present `
        -and $cn_present `
        -and $expected_topics_present `
        -and ($unexpected_cn.Count -eq 0) `
        -and $untitled_drafts_present
    )

    $result = [ordered]@{
        managed_contacts                 = $Expected.Count
        contacts_found                   = $contactsFound
        segment_membership_pass          = ($segMembershipOk -eq $Expected.Count)
        ygo_topic_matches                = $ygoMatches
        network_topic_matches            = $netMatches
        missing_preference_defaults_pass = ($missingDefaultOk -eq $absentCells)
        global_unsubscribed_count        = $globalUnsubCount
        drift_count                      = $driftReasons.Count
        drift_reasons                    = $driftReasons
        general_segment_present          = $general_present
        cn_segment_present               = $cn_present
        expected_topics_present          = $expected_topics_present
        unexpected_cn_topics             = $unexpected_cn
        untitled_drafts_present          = $untitled_drafts_present
        broadcasts_total_count           = $bc_total
        total_contacts_in_workspace      = $total_contacts_in_workspace
        overall_pass                     = $overall_pass
    }
}
catch {
    # Never surface the exception's URL/headers in case the API key
    # ends up in the message. Only a canned tag.
    $fatalReason = 'fatal_api_error'
    $result = [ordered]@{
        managed_contacts                 = $Expected.Count
        contacts_found                   = 0
        segment_membership_pass          = $false
        ygo_topic_matches                = 0
        network_topic_matches            = 0
        missing_preference_defaults_pass = $false
        global_unsubscribed_count        = 0
        drift_count                      = 1
        drift_reasons                    = @($fatalReason)
        general_segment_present          = $false
        cn_segment_present               = $false
        expected_topics_present          = $false
        unexpected_cn_topics             = @()
        untitled_drafts_present          = $false
        broadcasts_total_count           = 0
        total_contacts_in_workspace      = 0
        overall_pass                     = $false
    }
}
finally {
    # Immediate cleanup — never let the key linger.
    $key = $null
    $sec = $null
    $H   = $null
    Remove-Variable key, sec, H -ErrorAction SilentlyContinue
    [System.GC]::Collect() | Out-Null
}

$outPath = Join-Path $env:TEMP 'cn-d1-verify.json'
$result | ConvertTo-Json -Depth 6 | Out-File -FilePath $outPath -Encoding utf8 -NoNewline
Write-Host "Wrote $outPath"
