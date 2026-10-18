Two files, both go in netlify/functions/ of the ensemblefitness.com (marketing site) project:

  stripe-webhook.js  - now accepts a second signing secret (STRIPE_CONNECT_WEBHOOK_SECRET) so Stripe's
                       "connected accounts" webhook can point at the same function. Harmless until that
                       secret is added in Netlify.
  payout-status.js   - when our record says an artist isn't linked yet, it asks Stripe directly (read-only,
                       never writes or pays) so the Artist Upload page stops showing the bank screen to
                       someone who really did finish.
