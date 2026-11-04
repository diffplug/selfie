## COLD OPEN

You point your coding agent at one button. But most changes have unforeseen consequences.
**[A whole app on screen. Human hand points at a button, robot drops in and hammers it, panels far away from the button crack and tilt]**

## INTRO STORYBOOK

What if you took every page and component of your UI, and laid them out next to each other?
**[The app splits into pieces, which line up in a row]**

Now, let’s copy those components into every state the user will see: error states, empty states, easy ones, hard ones.
**[Zoom in on one, split it down the column into its states, then zoom out as every column fills the grid]**

StorybookJS has made that easy for the past 10 years. With coding agents, it’s more useful than ever: you can point at the specific page you want changed.
**[The grid gets a Storybook frame. Human hand points to a cell, robot comes and hammers on it]**

But how can you understand the full ripples of a code change?
**[Radial ripple from the hammer across the whole grid, knocking loose distant cells the robot can’t see]**

## INTRO CHROMATIC

Enter Chromatic. This is a cloud service which renders every component of a Storybook to an image.
**[A photo booth in a cloud. Components ride past the camera, flash, a photo comes out]**

Change the code, render every component to another image, and compare.
**[Two photos of the same component line up, and the difference is highlighted]**

This works great, but it requires waiting on a cloud service. At 0.8 cents per image, this was a reasonable expense at the speed of human code.
**[Coin meter on the booth, with a waiting bar. A person presses the button now and then, and a coin drops]**

But for a modest library of 1,000 stories, that’s 8 bucks for a full run, each time you even look at a code change!
**[A robot takes over the button, and the meter spins up to $8, $80, $800 under a flood of coins]**

## INTRO SELFIE

Introducing Selfie.dev: a snapshot testing tool which runs locally and in the cloud. Your agent takes its own picture.
**[Flash floods the screen with a new color. Selfie wordmark, robot with a pink phone takes a picture of itself]**

No waiting on a cloud rendering service, and no paying for each image. 541 stories in about 70 seconds.
**[Robot taking lots of goofy selfies with the components, photos pile up, the numbers land]**

It works just like git. Images are stored locally wherever the agent is running, and also in the cloud, so that every commit on GitHub shows the complete visual consequences of the code change.
**[Several robots on the ground, each with their own suitcase of photos, waving up to a shared photo wall in a cloud. Cut to a commit list with a `selfie` status on each commit]**

Approvals follow your history too, so they survive a commit, a rebase, or a merge.
**[A stamped photo rides along a git graph, keeping its stamp at each node]**

Every image is rendered in the same pinned environment, wherever it runs.
**[Identical containers on different machines, each producing the identical photo]**

Each image is named by a hash of its pixels. Most changes touch only a few, so only those few get sent.
**[Robot takes a single photo out of the suitcase, folds it into a paper airplane, and throws it up to the cloud]**

If you’re using StorybookJS, you can start using Selfie locally to review your changes right now, at selfie.dev.
**[Robots signing up outside of a space pad]**

If you want to use it in the cloud on your GitHub repositories, join our waitlist, and get a discount when we launch in mid-November.
**[Robots launch into space as they take selfies out the window. End card with the full mascot and the URL]**
