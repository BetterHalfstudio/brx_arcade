import type { Route } from "../router";

// Global top bar. The BRX_ARCADE title links the two tools.

export function TopNav({ route }: { route: Route }) {
  return (
    <nav className="nav">
      <a className="nav__brand" href="#/">
        <span className="br">BRX</span>_ARCADE
      </a>
      <div className="nav__tabs">
        <a className={"nav__tab" + (route === "/" ? " active" : "")} href="#/">
          DITHER
        </a>
        <a
          className={"nav__tab" + (route === "/face" ? " active" : "")}
          href="#/face"
        >
          FACE
        </a>
      </div>
      <span className="blip">
        <i />
        <i />
        <i />
      </span>
    </nav>
  );
}
