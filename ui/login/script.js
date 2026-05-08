(function () {
  "use strict";

  fetch("/api/check").then(function (res) {
    if (res.ok) window.location.href = "/";
  }).catch(function () {});

  var form = document.getElementById("login-form");
  var passwordInput = document.getElementById("password");
  var submitBtn = document.getElementById("submit-btn");
  var errorEl = document.getElementById("error");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";

    try {
      var res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.value }),
      });

      if (res.ok) {
        window.location.href = "/";
        return;
      }

      var data = await res.json();
      errorEl.textContent = data.error || "Login failed";
      errorEl.style.display = "block";
    } catch {
      errorEl.textContent = "Connection error";
      errorEl.style.display = "block";
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Log in";
    passwordInput.focus();
  });
})();
