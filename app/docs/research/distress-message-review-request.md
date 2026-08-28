# Review request: what our tutoring app says to a child in distress

- **Date:** 2026-08-28
- **Status:** AWAITING REVIEW by a suitably qualified person
- **Written by:** an engineer, which is the problem this document exists to fix
- **Criterion:** M4/M3 spec AC 21 · ADR-0012 follow-up

**Hand this whole document to the reviewer.** It is written for someone who has
never seen the codebase — a school counsellor, a designated safeguarding lead, a
child clinician, a children's-charity helpline trainer. Everything they need to
answer is here, and nothing they need to answer requires reading any code.

---

## What the product is

An AI tutor for school-age children, roughly 5 to 14. A child photographs their
homework; the app reads it, generates practice, and can hold a text conversation
about one problem at a time. The child types; there is no voice.

**A parent sets the account up and consents to it.** The child does not have
their own login. A parent can read every word of every conversation at any time.

## When this message appears

Every message the child types is checked against a fixed list of phrases before
it is sent anywhere. If one matches, the tutor **stops tutoring for that turn**
and replies with the text below — always exactly this text, never anything
generated. The conversation is not ended; the child can keep typing.

The phrases we currently match on cover:

- **Suicidal ideation** — "kill myself", "want to die", "wish I was dead",
  "better off dead", "don't want to be alive", "nobody would miss me"
- **Self-harm** — "hurt myself", "cutting myself", "self harm", "I hate myself"
- **Being hurt by someone** — "hits me", "beats me", "touched me",
  "being hurt/abused/bullied"
- **Fear for their own safety** — "scared to go home", "I don't feel safe",
  "running away from home"

## The exact text a child sees

> I want to stop the schoolwork for a moment. What you said sounds important,
> and it is bigger than something I can help with — I am a computer program that
> helps with homework. Please talk to a grown-up you trust about this: a parent,
> someone who looks after you, or a teacher at school. Telling someone is the
> right thing to do, and it is not something you should have to sort out on your
> own.

## What happens next — nothing, and that was a deliberate decision

**No one is alerted. No parent notification is sent. No report goes anywhere.**

The owner decided this on 2026-08-28, and the reasoning was:

- The check is a **phrase matcher, not an assessment**. It will fire on "I hate
  myself" typed in frustration at a fraction. An alert channel driven by that
  produces false alarms, which frightens a parent and then teaches them to
  ignore it.
- A child who learns the tutor reports them **stops telling it anything true** —
  and then the tutor is not a place anything is disclosed at all.
- A distress message is stored like any other message, so it **already appears
  in the transcript a parent can read**. That is passive, accurate, and does not
  depend on the matcher having been right.

**This decision is squarely in scope for your review.** If you think it is
wrong, say so — it is reversible, and it is exactly the kind of judgement we are
asking for.

## What we know is weak

Stated plainly, because a reviewer should not have to discover it:

- **We will miss things.** A child who says something serious in words that are
  not on the list gets tutored about fractions instead. We cannot measure how
  often.
- **We will misfire.** Frustration at homework and real distress use overlapping
  words.
- **We are not equipped for this.** The app is a homework tutor. Nothing here is
  a safeguarding system and it is not presented to anyone as one.
- **There is no helpline number in the message.** We have not decided whether
  naming a specific service is right for an app used across different countries
  by children of very different ages. This is also a question for you.

---

## The four questions we are asking

1. **Is this the right thing to say to a child, at this age range, in this
   moment?** If not, please write what it should say — we will use your words
   rather than adapt them.
2. **Should it name a specific helpline or service?** If yes, which, and how
   should it handle a child in a different country?
3. **Is "no one is alerted" the right call?** See the reasoning above.
4. **Are we matching on roughly the right things?** Additions and removals both
   welcome, in plain English — we will translate them into the check.

## What happens to your answer

Whatever you send back replaces the current text verbatim, in one commit, with
your review recorded against it. Until then the message above is what a
distressed child reads, and this document is the record that we know an engineer
wrote it.
