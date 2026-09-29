// Apply a saved theme choice before the page paints, to avoid a flash.
// Loaded without defer/async in <head> so it runs before the body renders.
try {
  var t = localStorage.getItem("deck32.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
