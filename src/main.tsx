import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "../orb.css";
import "../app.css";
import "../portal.css";
import "../views.css";
import "../mobile.css";
import "./styles/studio.css";
import { App } from "./app/App";
import { StudioProvider } from "./app/StudioProvider";

createRoot(document.getElementById("root")!).render(<StrictMode><StudioProvider><App /></StudioProvider></StrictMode>);
