export const FRAMEWORK_SIGNATURES: Record<string, string[]> = {
  // JS/TS
  express: ['express'],
  fastify: ['fastify'],
  nestjs: ['@nestjs/core'],
  nextjs: ['next'],
  react: ['react'],
  vue: ['vue'],
  svelte: ['svelte'],
  prisma: ['@prisma/client'],
  typeorm: ['typeorm'],
  drizzle: ['drizzle-orm'],
  trpc: ['@trpc/server'],
  graphql: ['graphql'],
  zod: ['zod'],
  langchain: ['langchain', '@langchain/core'],
  langgraph: ['@langchain/langgraph'],
  // Python (pyproject.toml dependencies)
  django: ['django'],
  flask: ['flask'],
  fastapi: ['fastapi'],
  sqlalchemy: ['sqlalchemy'],
  pydantic: ['pydantic'],
  celery: ['celery'],
  // Java
  spring: ['spring-boot-starter'],
  quarkus: ['quarkus-core'],
};
