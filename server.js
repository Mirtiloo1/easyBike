const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const bikes = new Map();
const qrCodeSessions = new Map();
const activeWsClients = new Map();

const EXTERNAL_URL =
  process.env.EXTERNAL_URL || "https://b6e2-191-255-149-4.ngrok-free.app";

app.use(express.static(path.join(__dirname, "public")));

function broadcastBikeStatusUpdate(bikeId, newStatus) {
  const bike = bikes.get(bikeId);
  if (!bike) return;

  const message = JSON.stringify({
    type: "bikeStatusUpdate",
    bikeId: bike.id,
    status: bike.status,
    location: bike.location,
    name: bike.name,
  });

  activeWsClients.forEach((wsClient) => {
    if (wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(message);
    }
  });

  console.log(
    `Broadcast: Status da bike ${bikeId} atualizado para ${newStatus}.`
  );
}

wss.on("connection", (ws) => {
  const connectionClientId = uuidv4();
  activeWsClients.set(connectionClientId, ws);
  console.log(
    `Cliente WebSocket [${connectionClientId}] conectado. Total: ${activeWsClients.size}`
  );

  ws.send(
    JSON.stringify({ type: "serverClientId", clientId: connectionClientId })
  );

  ws.on("message", (message) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error("Mensagem JSON inválida recebida:", message);
      return;
    }

    console.log(
      `Mensagem recebida do cliente [${connectionClientId}]:`,
      parsedMessage
    );

    if (parsedMessage.type === "clientHello") {
      console.log(
        `Cliente [${connectionClientId}] enviou clientHello com ID salvo: ${
          parsedMessage.clientId || "Nenhum"
        }`
      );
    } else if (parsedMessage.type === "requestNewQr") {
      const qrId = uuidv4();
      qrCodeSessions.set(qrId, {
        wsClient: ws,
        status: "pending",
        clientId: connectionClientId,
      });
      ws.send(
        JSON.stringify({ type: "init", qrId, externalUrl: EXTERNAL_URL })
      );
      console.log(
        `Novo QR Code ${qrId} gerado e enviado para o cliente ${connectionClientId}.`
      );
    } else if (parsedMessage.type === "resumeSession") {
      const { bikeId } = parsedMessage;
      const bike = bikes.get(bikeId);

      if (
        bike &&
        bike.status === "em_uso" &&
        (bike.usuario_atual === connectionClientId ||
          parsedMessage.clientId === bike.usuario_atual)
      ) {
        console.log(
          `Sessão da bicicleta ${bikeId} retomada para o cliente ${connectionClientId}.`
        );
        ws.send(
          JSON.stringify({
            type: "statusUpdate",
            qrId: bike.qrId_atual,
            status: "verified",
            bikeId: bike.id,
            horaInicioUso: bike.hora_inicio_uso,
          })
        );
      } else {
        console.log(
          `Tentativa de retomar sessão falhou para bike ${bikeId} e cliente ${connectionClientId}.`
        );
        ws.send(JSON.stringify({ type: "clearClientStateAndRequestNewQr" }));

        const newQrId = uuidv4();
        qrCodeSessions.set(newQrId, {
          wsClient: ws,
          status: "pending",
          clientId: connectionClientId,
        });
        ws.send(
          JSON.stringify({
            type: "init",
            qrId: newQrId,
            externalUrl: EXTERNAL_URL,
          })
        );
        console.log(
          `Novo QR Code ${newQrId} gerado e enviado para o cliente ${connectionClientId} após falha na retomada da sessão.`
        );
      }
    } else if (parsedMessage.type === "requestAllBikeStatuses") {
      const allBikesData = Array.from(bikes.values()).map((bike) => ({
        id: bike.id,
        status: bike.status,
        location: bike.location,
        name: bike.name || `Bicicleta ${bike.id}`,
      }));
      ws.send(JSON.stringify({ type: "allBikeStatuses", bikes: allBikesData }));
      console.log(
        `Status de ${allBikesData.length} bikes enviado para o cliente de mapa [${connectionClientId}].`
      );
    }
  });

  ws.on("close", () => {
    activeWsClients.delete(connectionClientId);
    console.log(
      `Cliente WebSocket [${connectionClientId}] desconectado. Total: ${activeWsClients.size}`
    );
  });

  ws.on("error", (error) => {
    console.error(
      `Erro no WebSocket do cliente [${connectionClientId}]:`,
      error
    );
  });
});

app.get("/verify/:qrId", (req, res) => {
  const { qrId } = req.params;
  const session = qrCodeSessions.get(qrId);

  if (session) {
    if (session.status === "pending") {
      session.status = "verified";
      qrCodeSessions.set(qrId, session);

      const bikeIdToAssign = "bike-001";
      const bike = bikes.get(bikeIdToAssign);

      if (bike && bike.status === "disponivel") {
        bike.status = "em_uso";
        bike.qrId_atual = qrId;
        bike.usuario_atual = session.clientId;
        bike.hora_inicio_uso = Date.now();
        bikes.set(bikeIdToAssign, bike);
        console.log(
          `QR Code ${qrId} verificado. Bicicleta ${bikeIdToAssign} marcada como 'em_uso'.`
        );

        if (
          session.wsClient &&
          session.wsClient.readyState === WebSocket.OPEN
        ) {
          session.wsClient.send(
            JSON.stringify({
              type: "statusUpdate",
              qrId: qrId,
              status: "verified",
              bikeId: bikeIdToAssign,
              horaInicioUso: bike.hora_inicio_uso,
            })
          );
        }

        broadcastBikeStatusUpdate(bikeIdToAssign, bike.status);

        res.status(200).send(`
            <html lang="pt-br">
            <head><meta charset="UTF-8"><title>QR Code Verificado</title>
            <style>body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #e6ffe6; color: #006400; } .container { text-align: center; padding: 20px; border-radius: 8px; background-color: white; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }</style>
            </head>
            <body><div class="container"><h1>✅ QR Code Verificado com Sucesso!</h1><p>Bicicleta ${bikeIdToAssign} liberada! Você pode fechar esta página.</p></div></body>
            </html>
        `);
      } else {
        console.log(
          `QR Code ${qrId} verificado, mas bicicleta ${bikeIdToAssign} não disponível ou não encontrada.`
        );
        res.status(400).send(`
            <html lang="pt-br">
            <head><meta charset="UTF-8"><title>Bicicleta Indisponível</title>
            <style>body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #fff0f0; color: #d00000; } .container { text-align: center; padding: 20px; border-radius: 8px; background-color: white; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }</style>
            </head>
            <body><div class="container"><h1>⚠️ Bicicleta Indisponível!</h1><p>A bicicleta associada a este QR Code não está disponível para uso.</p></div></body>
            </html>
        `);
      }
    } else {
      console.log(`QR Code ${qrId} já foi verificado anteriormente.`);
      res.status(400).send(`
            <html lang="pt-br">
            <head><meta charset="UTF-8"><title>QR Code Já Utilizado</title>
            <style>body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #fff0f0; color: #d00000; } .container { text-align: center; padding: 20px; border-radius: 8px; background-color: white; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }</style>
            </head>
            <body><div class="container"><h1>⚠️ QR Code Já Utilizado!</h1><p>Este QR Code já foi escaneado e validado anteriormente.</p></div></body>
            </html>
        `);
    }
  } else {
    console.log(`QR Code ${qrId} inválido ou não encontrado.`);
    res.status(404).send(`
        <html lang="pt-br">
        <head><meta charset="UTF-8"><title>QR Code Inválido</title>
        <style>body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f0f0ff; color: #5050d0; } .container { text-align: center; padding: 20px; border-radius: 8px; background-color: white; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }</style>
        </head>
        <body><div class="container"><h1>❌ QR Code Inválido!</h1><p>Este QR Code não é reconhecido pelo sistema.</p></div></body>
        </html>
    `);
  }
});

app.post("/end-use/:bikeId", (req, res) => {
  const { bikeId } = req.params;
  const bike = bikes.get(bikeId);

  if (bike && bike.status === "em_uso") {
    const tempoTotalMs = Date.now() - bike.hora_inicio_uso;
    console.log(
      `Uso da bicicleta ${bikeId} finalizado. Tempo: ${
        tempoTotalMs / 1000
      } segundos.`
    );

    const clientToNotifyId = bike.usuario_atual;

    bike.status = "disponivel";
    bike.qrId_atual = null;
    bike.usuario_atual = null;
    bike.hora_inicio_uso = null;
    bikes.set(bikeId, bike);

    const sessionToNotify = activeWsClients.get(clientToNotifyId);
    if (sessionToNotify && sessionToNotify.readyState === WebSocket.OPEN) {
      sessionToNotify.send(
        JSON.stringify({
          type: "usageEnded",
          bikeId: bikeId,
          tempoTotalMs: tempoTotalMs,
        })
      );
    }

    broadcastBikeStatusUpdate(bikeId, bike.status);

    res
      .status(200)
      .json({ message: "Uso finalizado com sucesso!", tempoTotalMs });
  } else {
    res
      .status(404)
      .json({ message: "Bicicleta não encontrada ou não está em uso." });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);

  if (bikes.size === 0) {
    bikes.set("bike-001", {
      id: "bike-001",
      status: "disponivel",
      location: { lat: -24.004884, lon: -46.412638 },
      qrId_atual: null,
      usuario_atual: null,
      hora_inicio_uso: null,
      name: "Praça 19 de Janeiro - Boqueirão",
    });

    bikes.set("bike-002", {
      id: "bike-002",
      status: "disponivel",
      location: { lat: -23.999038, lon: -46.413919 },
      qrId_atual: null,
      usuario_atual: null,
      hora_inicio_uso: null,
      name: "Terminal Tude Bastos",
    });

    bikes.set("bike-003", {
      id: "bike-003",
      status: "manutencao",
      location: { lat: -24.013643, lon: -46.42164 },
      qrId_atual: null,
      usuario_atual: null,
      hora_inicio_uso: null,
      name: "Feirinha da Guilhermina",
    });

    console.log(
      "Bicicletas de exemplo populadas:",
      Array.from(bikes.values()).map((b) => b.id)
    );
  }

  if (
    EXTERNAL_URL === "http://localhost:3000" &&
    process.env.NODE_ENV !== "production"
  ) {
    console.warn(
      "AVISO: EXTERNAL_URL não está configurada. O QR Code pode não funcionar em outras redes."
    );
    console.warn(
      'Inicie o ngrok (ex: ngrok http 3000) e defina EXTERNAL_URL="https://SUA_URL.ngrok-free.app" antes de rodar o servidor, ou edite diretamente no server.js.'
    );
  } else {
    console.log(`URL externa configurada para: ${EXTERNAL_URL}`);
  }
});
