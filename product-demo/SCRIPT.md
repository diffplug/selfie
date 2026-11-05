## THE ASK

I asked my coding agent to give the top bar a bit more room. Two lines of CSS. Then it runs selfie render.
**[Terminal: the request, the real two-line diff, and the command]**

That renders all 142 stories in a pinned container, right here on this MacBook Air, in under 30 seconds, with no cloud and no bill per image.
**[Terminal: the real render log and its timings]**

## THE REVIEW

Now it’s my turn. The selfie ui command shows me what changed: those two lines touched every story. But Selfie has already found the changes repeated across them. I look through them, accept them, and 63 of the 142 are done.
**[Selfie UI: the batch and its Repeated changes. Look through the first, and accept the two biggest]**

But what about dark mode? I search for dark, and there it is: 85,000 changed pixels. Press F, and the images swap in place. The top bar went white.
**[Search for dark. The dark story, its numbers, and a flip between golden and current]**

## ASKING MUSE SPARK

Selfie can tell me exactly which pixels changed, but not why. The commit is on GitHub, so I open the same story in the cloud, and ask Muse Spark what caused it.
**[The real GitHub status, the hosted story, and the question being asked]**

It reads the before, the after, the diff, and the code, and it finds the line. Then it spots what I never asked for: a fixed light color, where the theme’s color used to be. It even tells me to check dark mode.
**[Muse Spark's real answer arriving, with the code it says it read]**

## THE LOOP

So back in my review, I click the change, write a note, and send it to the agent, which has been waiting.
**[Click the hunk, type the note, press Send to agent]**

It gets my words, the exact box, and a picture of what I saw.
**[Terminal: the real note it received, beside the image with the box on it]**

It puts the theme’s color back, renders again, and answers my note.
**[Terminal: the real fix, render, and reply]**

The bar is dark again, and 85,000 changed pixels are down to 13.
**[The reply on the story, the white and fixed images, and the new number]**

I approve the rest, and the agent commits and reviews once more. It’s the exact same build, so nothing renders. Under half a second, and exit 0.
**[Approve all, then the terminal: the real commit and final review, reusing the images]**

## THE END

Selfie works with any coding agent. If you have a Storybook, you can start locally today, and the link’s in the description.
**[End card]**
