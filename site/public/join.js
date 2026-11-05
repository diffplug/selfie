// Mailing list signup. Posts straight to MailerLite and shows the result in place,
// so the visitor never leaves the page. Without JavaScript the form still posts.
(() => {
  const form = document.querySelector("form.join");
  if (!form) return;
  const email = form.querySelector('input[type="email"]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".join-status");

  // The shutter is a link to #join: bring the form into view and put the cursor in it.
  document.querySelectorAll('a[href="#join"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      form.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
      email.focus({ preventScroll: true });
      history.replaceState(null, "", "#join");
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!email.checkValidity()) {
      email.reportValidity();
      return;
    }
    button.disabled = true;
    status.textContent = "Joining…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new URLSearchParams(new FormData(form)),
      });
      const result = await response.json();
      if (result.success) {
        form.classList.add("done");
        status.textContent = "Check your inbox to confirm. Then you're on the list.";
        return;
      }
      const problem = result.errors && result.errors.fields && result.errors.fields.email;
      status.textContent = problem ? problem[0] : "That didn't work. Try again in a moment.";
    } catch {
      status.textContent = "That didn't work. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  });
})();
