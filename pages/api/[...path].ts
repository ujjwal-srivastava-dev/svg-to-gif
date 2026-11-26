import type { NextApiRequest, NextApiResponse } from 'next';
import { createApi } from '../../lib/api.ts';

const state = globalThis as typeof globalThis & {
  svgStudioApi?: ReturnType<typeof createApi>;
};

export const config = {
  api: { bodyParser: false, responseLimit: false },
  maxDuration: 300,
};

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  try {
    state.svgStudioApi ??= createApi().catch((error) => {
      delete state.svgStudioApi;
      throw error;
    });

    const api = await state.svgStudioApi;
    await api.handler(request, response);
  } catch (error) {
    console.error('Server initialization failed:', error);
    response
      .status(503)
      .json({ error: 'The service is unavailable. Check the deployment configuration.' });
  }
}
