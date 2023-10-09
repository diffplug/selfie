function selfieMain() {
    const main = document.getElementById("main");

    function calculateContentHeight() {
        document.body.style.setProperty("--content-height", main.offsetHeight + "px")
        document.body.style.setProperty("--selfie-bot", "-" + main.scrollTop + "px")
    }

    calculateContentHeight()

    function delayAndCalculateContentHeight() {
        setTimeout(calculateContentHeight, 100)
    }

    function onContentScroll(e) {
        document.body.style.setProperty("--selfie-bot", "-" + e.target.scrollTop + "px")
    }

    main.addEventListener("scroll", onContentScroll, false);

    document.querySelectorAll("#filter-section > button")
        .forEach(f => {
            f.addEventListener("click", delayAndCalculateContentHeight)
        })
}

window.addEventListener("load", selfieMain)
