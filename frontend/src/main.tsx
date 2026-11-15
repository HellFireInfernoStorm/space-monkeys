import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import LandingPage from "./components/LandingPage";
import { isLandingPage } from "./pageRoute";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isLandingPage(window.location.pathname, window.location.search) ? <LandingPage /> : <App />}
  </StrictMode>,
);
