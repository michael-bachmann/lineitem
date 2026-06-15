/// <reference types="vite/client" />

// SVGs imported with the `?react` query (vite-plugin-svgr) become React
// components. Declared here so type-checking the shared <Mark> (which imports
// mark.svg?react) resolves from this app too.
declare module "*.svg?react" {
  import type { FunctionComponent, SVGProps } from "react";
  const ReactComponent: FunctionComponent<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}
