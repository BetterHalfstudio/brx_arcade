import type { Route } from "../router";
import { FACE_VERSIONS } from "../face/versions";

// Global top bar. The BRX_ARCADE title links the two tools. The small version
// buttons appear only on the FACE tool.

export function TopNav({
  route,
  faceVersion,
  onFaceVersion,
}: {
  route: Route;
  faceVersion: number;
  onFaceVersion: (v: number) => void;
}) {
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
        {route === "/face" && (
          <div className="nav__vers">
            {FACE_VERSIONS.map((v) => (
              <button
                key={v.id}
                className={"nav__ver" + (faceVersion === v.id ? " active" : "")}
                onClick={() => onFaceVersion(v.id)}
                title={`FACE ${v.label}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="blip">
        <i />
        <i />
        <i />
      </span>
    </nav>
  );
}
