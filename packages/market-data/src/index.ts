// @collector-network/market-data — package shell.
//
// Intended responsibility: shared *read* logic on top of the market and graded
// price tables (tcg_market_prices_current, tcg_market_price_daily,
// tcg_graded_prices_current, tcg_graded_price_daily). Handles concepts like
// "current price", "daily history", "movers", condition/grade normalisation.
//
// This package is read-only. Ingestion of prices happens elsewhere.

export const __market_data_package_placeholder = true;
