import { createRoot } from "react-dom/client";
import { initStore } from "./store";
import App from "./app";
initStore().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => undefined); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => undefined); }); });
}
