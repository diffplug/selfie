INTRO STORYBOOK

What if you took every page and component of your UI, and laid it out next to each other.
**[Application splits horizontally into pieces]**

Now, let’s copy those components, and put them into every state the user will see - error states, empty states, easy ones, hard ones.
**\[Zoom in on one, split it down the column into error state, empty state, etc]**

StorybookJS has made it easy for users to do exactly that for the past 10 years. With the advent of coding agents, it’s more useful than ever - you can use the Storybook as a control surface by pointing to the specific page you want changed
**\[Human hand points to a spot, Robot comes and hammers on it]**

INTRO SNAPSHOT

But most changes have unforseseen consequences.
**\[Pieces of the robot’s contstruction bang down and damge the components below it]**

How can you understand the full ripples of a code change?
**\[Zoom out for a radial “bump” of the entire compoent grid]**

Enter Chromatic. This is a cloud service which renders every component of a Storybook to an image. Change the code, render every component to another image, and compare.
**\[Photo Booth, put the component in front of camera take picture, change component, take another picture, line up the pictures to highlight the difference]**

This works great, but it requires waiting on a cloud service. At 0.8 cents per image, this was a reasonable expense at the speed of human code. But for a modest library of 1,000 stories, that’s 8 bucks for each time you even look at a code change!

ENTER SELFIE

Introducing Selfie.dev - a snapshot testing tool which runs locally and in the cloud. Now your coding agent can take the snapshots itself, without waiting (or paying) for a cloud rendering service.
**[Robot taking lots of goofy selfies with the components]**

It works just like git. Screenshots are stored locally wherever the agent is running, and also in the cloud so that every commit in GitHub shows the complete visual consequences of the code change.
**\[Several robots on the ground, each with their own suitcase of photos, waving up to an agent in a cloud with its own suitcase]**

Screenshots are generated inside a reproducible container, so that you get the exact same pixels wherever the test is run. Screenshots are hashed on their content, and most runs change very few snapshots. The client and server show each other the set of hashes for all of the images. They only need to send the full image if a hash has changed.
**\[Robot takes a single photo out of the suitecase, folds it into a paper airplane, and throws it up to the cloud]**

If you’re using StorybookJS, you can start using the Selfie locally to review your changes right now, at selfie.dev. If you want to use it in the cloud on your GitHub repositories, you can add yourself to our waitlist and get a launch discount when we launch in mid-November.
**\[Robots signing up outside of a space pad, then launching into space as they take selfies out the window]**
