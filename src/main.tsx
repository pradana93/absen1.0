import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Registrasi Service Worker (PWA). Gagal senyap bila lingkungan tidak mendukung.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* lingkungan pratinjau mungkin membatasi SW — aplikasi tetap berjalan */
    });
  });
}
