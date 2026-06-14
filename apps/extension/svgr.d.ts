// @lineitem/ui's Mark imports mark.svg?react, but that package's declaration
// for the `?react` query lives outside this app's tsconfig include. Pull it in
// so `tsc --noEmit` resolves the import.
/// <reference path="../../packages/ui/src/svg.d.ts" />
