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
        const isFound = codeBlocks.some(function(cb) {
            const parent = cb.parentElement;
            const parentHasBorder = hasBorder(parent);
            bot.style.marginRight = parentHasBorder ? "4px" : "0";
            const element = parentHasBorder ? parent : cb;
            baseBotOffset = element.getBoundingClientRect().top - SELFIE_BOT_HEIGHT;
            return element.offsetParent !== null;
        })
        if (isFound) {
            bot.style.setProperty("--selfie-bot", "" + baseBotOffset - main.scrollTop + "px");
            fadeBotIn();
        } else {
            hideBot();
        }
    }

    function fadeBotIn() {
        bot.style.setProperty("--selfie-opacity", "1");
        bot.style.opacity = "var(--selfie-opacity)";
    }

    function hideBot() {
        bot.style.setProperty("--selfie-opacity", "0");
    }

    calculateBotOffset();

    main.addEventListener("scroll", onContentScroll, false);
    let timeout;
    window.onresize = function(){
        clearTimeout(timeout);
        timeout = setTimeout(calculateBotOffset, 50);
    };
}

window.addEventListener("load", selfieMain);

function hasBorder(element) {
    return element.matches(".cover > .with-platform-tabs > .content");
}
