function selfieMain() {
    const main = document.getElementById("main");
    document.body.style.setProperty("--content-height", main.offsetHeight + "px")
    document.body.style.setProperty("--selfie-bot", "-" + main.scrollTop + "px")

    function onContentScroll(e) {
        document.body.style.setProperty("--selfie-bot", "-" + e.target.scrollTop + "px")
    }

    main.addEventListener("scroll", onContentScroll, false);
}

window.addEventListener("load", selfieMain)
