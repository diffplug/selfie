const SELFIE_BOT_HEIGHT = 300; // matches height in stylesheet

function selfieMain() {
    const main = document.getElementById("main");
    let initialBotOffset = 0;

    function onContentScroll(e) {
        document.body.style.setProperty("--selfie-bot", "" + initialBotOffset - e.target.scrollTop + "px")
    }

    function initializeBotOffset() {
        // The bottom of the selfie bot should align with the top of the first visible code block
        const codeBlocks = Array.from(main.querySelectorAll(".symbol"));
        codeBlocks.some((cb, idx) => {
            initialBotOffset = cb.offsetTop - SELFIE_BOT_HEIGHT;
            return cb.offsetParent !== null
        })
        document.body.style.setProperty("--selfie-bot", "" + initialBotOffset - main.scrollTop + "px")
    }

    initializeBotOffset();

    main.addEventListener("scroll", onContentScroll, false);
}

window.addEventListener("load", selfieMain)
