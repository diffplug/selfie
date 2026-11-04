## THE ASK

I asked my coding agent for one small thing: give the top bar a bit more room. It changed two lines of CSS. Looks fine, right?
**[Terminal: the request, and the real two-line diff]**

So the agent runs selfie review. That renders every story in our Storybook, 124 of them, in a pinned container, right here on this MacBook Air. Twenty-five seconds, with no cloud and no bill per image.
**[Terminal: the real render log, ending on its real timings]**

What comes back is one JSON document and an exit code, so any agent can read it. Exit 1, because that two-line change touched all 124 stories.
**[Terminal: the real JSON, trimmed, and the exit code]**

## THE REVIEW

Now it’s my turn. The selfie ui command opens the same review for a person: 124 changed, and nothing decided yet.
**[Selfie UI: the batch, its counts]**

That’s a lot to look at, but Selfie works out what kind of change each one is. 48 of them only moved or gained spacing, with nothing new in the image.
**[Show filter: Moved and spacing only, 48 of 124]**

Here’s one. Yellow is spacing that grew. Press F, and the two images flip in place, so you can see exactly what moved.
**[A spacing-only story. Stack it, and flip between golden and current]**

That looks right, so I approve those 48 together.
**[The bulk dialog, listing what it will approve]**

But what about dark mode? I search for dark, and there it is: 85,000 changed pixels. The agent hard-coded a light color, and the top bar went white.
**[Search for dark. The dark story, its numbers, and the white bar]**

## THE LOOP

I don’t have to describe where. I click the change, write what’s wrong, and send it to the agent, which has been waiting.
**[Click the hunk, type the note, press Send to agent]**

The agent gets my words, the story, the exact box, and a picture of what I saw.
**[Terminal: the real note it received, beside the real image with the box drawn on it]**

It puts the theme’s color back, renders again, and answers my note.
**[Terminal: the real fix, render, and reply]**

Selfie tells me there’s a newer batch, and the reply is right there on the story. The bar is dark again, and 85,000 changed pixels are down to 13.
**[The newer batch banner, the reply, the white and fixed images, and the new number]**

I resolve the note, and approve the rest. The 48 I already approved are simply unchanged now, because an approval follows your Git history.
**[Resolve, Approve all, and the batch with nothing blocking and 48 unchanged]**

The agent commits and reviews once more. It’s the exact same build, so nothing renders. A third of a second, and exit 0.
**[Terminal: the real commit and final review, reusing the images]**

## THE CLOUD

Push it, and Selfie renders in CI and puts a status on the commit. Click through, and it’s the same review, in the cloud.
**[The real GitHub commit list, its selfie status, and the hosted review]**

Selfie works with any coding agent. If you have a Storybook, start locally today at selfie.dev, and join the waitlist for the cloud.
**[End card]**
