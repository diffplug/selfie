function selfieMain() {
    const main = document.getElementById("main");
    const bot = document.getElementById("selfie-navigation-bot")

    function onContentScroll(e) {
        document.body.style.setProperty("--selfie-bot", "-" + e.target.scrollTop + "px")
    }

    main.addEventListener("scroll", onContentScroll, false);
}

selfieMain();
