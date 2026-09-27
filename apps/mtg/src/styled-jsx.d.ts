// Local mirror of styled-jsx/global.d.ts.
// Workspace pnpm hoisting doesn't surface styled-jsx as an ambient
// module the way standalone npm install did, so TypeScript's auto
// type-acquisition never picks up the augmentation and <style jsx>
// fails to compile. Preservation migration: keep behaviour identical
// to the standalone repo.

import 'react'

declare module 'react' {
  interface StyleHTMLAttributes<T> {
    jsx?: boolean
    global?: boolean
  }
}
