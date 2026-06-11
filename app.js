(() => {
  const script = document.createElement("script");
  script.src = "public/app.js";
  script.defer = true;
  document.head.appendChild(script);
})();
