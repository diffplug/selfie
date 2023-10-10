const SELFIE_BOT_HEIGHT = 300; // matches height in stylesheet

function selfieMain() {
    const main = document.getElementById("main");
    const bot = document.getElementById("selfie-navigation-bot");
    let baseBotOffset = 0;

    function onContentScroll(e) {
        bot.style.setProperty("--selfie-bot", "" + baseBotOffset - e.target.scrollTop + "px");
    }

    function calculateBotOffset() {
        // The bottom of the selfie bot should align with the top of the first visible code block
        const codeBlocks = Array.from(main.querySelectorAll(".symbol"));
        codeBlocks.some((cb, idx) => {
            const box = cb.getBoundingClientRect()
            baseBotOffset = box.top - SELFIE_BOT_HEIGHT;
            return cb.offsetParent !== null;
        })
        bot.style.setProperty("--selfie-bot", "" + baseBotOffset - main.scrollTop + "px");
        fadeBotIn();
    }

    function fadeBotIn() {
        bot.style.setProperty("--selfie-opacity", "1");
        bot.style.opacity = "var(--selfie-opacity)";
    }

    calculateBotOffset();

    main.addEventListener("scroll", onContentScroll, false);
    let timeout;
    window.onresize = function(){
        clearTimeout(timeout);
        timeout = setTimeout(calculateBotOffset, 100);
    };
}

window.addEventListener("load", selfieMain);
