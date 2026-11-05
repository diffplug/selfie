# Chat — Rationale

> Informative companion to [chat.md](chat.md): the evidence behind its rules, keyed by that spec's headings. Nothing here is normative.

## Asking

**Anyone can ask.** Ned's call on 2026-11-04, for a service that's only up for the hackathon. Everything it reads is already public, so the only thing at risk is spending. Before this stays up longer, or takes a private repository, this should need a person signed in.

**Ten questions a minute.** Without a limit, anyone could use this as a free model, since a page supplies its own conversation. Cloudflare's limiter is per location and eventually consistent, and it's loose in practice.

**Measured 2026-11-04** on the deployed Worker, from one address, with a story that isn't in the batch, so that nothing reached the model: 14 requests in a burst were all let through, and then only 3 of 45 at about one a second were refused. So someone can ask far more than 10 a minute, and at the costs below, one script could spend several dollars a minute. Only sign-in, or something outside this Worker, would really bound that.

**What a question costs.** Measured 2026-11-04, from the usage each question logs, at `muse-spark-1.3`'s prices: 15,864 tokens in and 859 out for a 16-file range, $0.02, and 60,476 in and 1,110 out for a 148-file range, $0.08. Reasoning was more than half of what came out. A question repeated on the same range showed no cached tokens. The first text took 11 to 13 s, of which about 4 s is before the model is asked.

## What it may do

**Standard, not contributor.** Contributor models cost about 8 to 20 times less, and they let Meta train on what's sent. The code here is public, but that's the repository owner's to agree to, and at a few cents a question there's little to save. They're also limited to 150 requests a minute, against 3,000.

**No tools.** Anyone who can push a branch to a hosted repository can put words in front of the model, in code or in a rendered story. The instructions tell it to ignore them, which isn't a boundary. Having no tools and no links is, since the worst it can then do is say something wrong to the person reading, who's been told it can be wrong and decides for themselves.
