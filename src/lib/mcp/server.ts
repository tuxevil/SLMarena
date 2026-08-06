import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getArenaLeaderboard, leaderboardInputSchema } from "./leaderboard";
import { getModelProfile, modelProfileInputSchema } from "./profile";
import { createTestScenario, createScenarioInputSchema, listTestScenarios, listTestInputSchema } from "./scenarios";
import { checkJobStatus, getTestRunDetails, jobStatusInputSchema, launchMatrixTest, launchMatrixInputSchema, runDetailsInputSchema } from "./runs";
import { readLeaderboardResource, readScenariosResource } from "./resources";

function jsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "slmarena-mcp",
    version: "1.0.0",
  });

  // ---- Read tools ----

  server.registerTool(
    "get_arena_leaderboard",
    {
      title: "Obtener ranking de modelos",
      description:
        "Retorna el ranking actual de modelos de SLMarena, ordenable por calidad, velocidad, seguridad o Arena Index, con filtros de velocidad mínima y categoría.",
      inputSchema: leaderboardInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getArenaLeaderboard(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_model_profile",
    {
      title: "Obtener perfil de modelo",
      description:
        "Extrae el expediente de un modelo específico: promedios históricos del leaderboard y, opcionalmente, su rendimiento agregado en un escenario concreto.",
      inputSchema: modelProfileInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getModelProfile(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_test_scenarios",
    {
      title: "Listar escenarios de prueba",
      description: "Lista los escenarios y plantillas de prueba guardados en SLMarena, generales o de seguridad.",
      inputSchema: listTestInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await listTestScenarios(args ?? {}));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_test_run_details",
    {
      title: "Obtener detalles de ejecución",
      description:
        "Devuelve el desglose completo de una ejecución: telemetría por modelo, turns, evaluación del juez, respuestas originales del SLM y estado.",
      inputSchema: runDetailsInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await getTestRunDetails(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- Write / execute tools ----

  server.registerTool(
    "create_test_scenario",
    {
      title: "Crear escenario de prueba",
      description:
        "Redacta y guarda un nuevo escenario (System Prompt + secuencia de mensajes de usuario) en la base de datos de SLMarena para futuras pruebas.",
      inputSchema: createScenarioInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await createTestScenario(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "launch_matrix_test",
    {
      title: "Lanzar test matricial",
      description:
        "Dispara una ejecución matricial: lanza cada escenario dado (o ALL_SECURITY) contra los modelos objetivo (o ALL) en la cola asíncrona de SLMarena. Retorna los run_id de seguimiento.",
      inputSchema: launchMatrixInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await launchMatrixTest(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "check_job_status",
    {
      title: "Consultar estado de ejecución",
      description:
        "Consulta el progreso de una ejecución asíncrona: estado (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED), porcentaje de progreso y métricas parciales.",
      inputSchema: jobStatusInputSchema,
    },
    async (args) => {
      try {
        return jsonContent(await checkJobStatus(args));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- Resources ----

  server.registerResource("slmarena://leaderboard", "slmarena://leaderboard", { mimeType: "application/json", title: "Leaderboard SLMarena" }, async () => {
    try {
      return { contents: [await readLeaderboardResource()] };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  server.registerResource("slmarena://scenarios", "slmarena://scenarios", { mimeType: "application/json", title: "Escenarios de prueba" }, async () => {
    try {
      return { contents: [await readScenariosResource()] };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  });

  return server;
}