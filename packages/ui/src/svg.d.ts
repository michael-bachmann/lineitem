// SVGs imported with the `?react` query (vite-plugin-svgr) become React
// components. Self-contained so it doesn't depend on svgr's types being
// resolvable from this package.
declare module "*.svg?react" {
  import type { FunctionComponent, SVGProps } from "react";
  const ReactComponent: FunctionComponent<SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}
