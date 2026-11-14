import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { SpacetimeProvider } from "./spacetime/SpacetimeContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SpacetimeProvider>
          <App />
        </SpacetimeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
