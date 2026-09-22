import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  GeographyService,
  defaultGeographyService,
} from '../../../services/geography.service.js';

export interface CountriesRouteOptions {
  geographyService?: GeographyService;
}

const CountryIdentifierParamSchema = z.object({
  identifier: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/, 'Identifier must be alphanumeric or valid slug/UUID'),
});

export const countriesRoutes: FastifyPluginAsync<CountriesRouteOptions> = async (
  fastify,
  opts,
) => {
  const service = opts.geographyService ?? defaultGeographyService;

  /**
   * GET /api/v1/countries
   * Returns list of all active countries for country discovery and routing.
   */
  fastify.get('/countries', async (_request, reply) => {
    const countriesList = await service.listActiveCountries();
    return reply.status(200).send({
      data: countriesList,
    });
  });

  /**
   * GET /api/v1/countries/:identifier
   * Returns a specific country by UUID, ISO code (e.g. KE), or URL prefix (e.g. ke).
   */
  fastify.get('/countries/:identifier', async (request, reply) => {
    const parsed = CountryIdentifierParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message: parsed.error.issues[0]?.message ?? 'Invalid country identifier',
          requestId: request.id,
        },
      });
    }

    const country = await service.getActiveCountryByIdentifier(
      parsed.data.identifier,
    );

    if (!country) {
      return reply.status(404).send({
        error: {
          code: 'COUNTRY_NOT_FOUND',
          message: 'The requested country was not found.',
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: country,
    });
  });
};
