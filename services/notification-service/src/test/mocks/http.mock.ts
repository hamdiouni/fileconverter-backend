export function createMockHttpClient(behavior: 'success' | 'fail' | 'fail_then_succeed' = 'success') {
  let callCount = 0;
  return {
    post: jest.fn().mockImplementation(async () => {
      callCount++;
      if (behavior === 'success') return { status: 200 };
      if (behavior === 'fail')
        throw Object.assign(new Error('Connection refused'), { response: { status: 503 } });
      if (behavior === 'fail_then_succeed') {
        if (callCount < 2)
          throw Object.assign(new Error('Transient error'), { response: { status: 500 } });
        return { status: 200 };
      }
    }),
    getCallCount: () => callCount,
  };
}

export function createMockEmailClient() {
  return { send: jest.fn().mockResolvedValue({ statusCode: 202 }) };
}
