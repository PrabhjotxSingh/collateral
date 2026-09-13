import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MapEditor } from "./MapEditor";
import { WeaponFramer } from "./WeaponFramer";
import "./style.css";

type Tool = "home" | "maps" | "weapons";

function Launcher() {
  const [tool, setTool] = useState<Tool>("home");
  if (tool === "maps") return <MapEditor onHome={() => setTool("home")} />;
  if (tool === "weapons")
    return <WeaponFramer onHome={() => setTool("home")} />;
  return (
    <div className="engine-home">
      <header>
        <b>C/</b>
        <span>COLLATERAL ENGINE</span>
        <small>AUTHORING SUITE</small>
      </header>
      <main>
        <p className="kicker">SELECT A WORKSPACE</p>
        <h1>BUILD THE BATTLEFIELD.</h1>
        <div className="tool-grid">
          <button onClick={() => setTool("maps")}>
            <span>01</span>
            <strong>MAP EDITOR</strong>
            <p>
              Scale arenas, bake collision, place spawns, lights, and skyboxes.
            </p>
            <i>LAUNCH →</i>
          </button>
          <button onClick={() => setTool("weapons")}>
            <span>02</span>
            <strong>CHARACTER / WEAPON FRAMER</strong>
            <p>
              Frame first-person arms, pose fingers, fit world weapons, and
              export packages.
            </p>
            <i>LAUNCH →</i>
          </button>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Launcher />);
