import crypto from 'crypto';

export function createMockStripe() {
  return {
    checkout: {
      sessions: {
        create: async (params: any) => ({
          id: `cs_test_${crypto.randomBytes(8).toString('hex')}`,
          url: `https://checkout.stripe.com/pay/cs_test_mock`,
          ...params,
        }),
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: any) => ({
          id: `bps_test_${crypto.randomBytes(8).toString('hex')}`,
          url: `https://billing.stripe.com/session/bps_test_mock`,
          ...params,
        }),
      },
    },
    webhooks: {
      constructEvent: (body: string, signature: string, _secret: string) => {
        // In tests, signature 'valid_sig' always passes; others throw
        if (signature !== 'valid_sig' && !signature.startsWith('t=')) {
          throw new Error('Invalid signature');
        }
        return JSON.parse(body);
      },
    },
  };
}
