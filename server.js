const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Simulação de banco de dados de bicicletas
const bikes = new Map(); // bikeId -> { id, status, location: {lat, lon}, qrId_atual, usuario_atual, hora_inicio_uso }

// Configure aqui a URL pública que o ngrok fornecerá.
// Exemplo: 'https://seu-subdominio.ngrok-free.app'
// É CRUCIAL que esta URL esteja correta para o QR code funcionar externamente.
const EXTERNAL_URL =
  process.env.EXTERNAL_URL ||
  "https://d5ca-2804-7f0-9601-4305-3078-42d5-6592-30ae.ngrok-free.app"; // Mude para sua URL do ngrok

// Serve arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, "public")));

// Armazena o status dos QR codes e a qual cliente WebSocket pertencem
const qrCodeSessions = new Map(); // qrId -> { wsClient, status: 'pending' | 'verified' }

wss.on("connection", (ws) => {
  let clientId = null; // será definido ao receber "hello"

  console.log(`Cliente WebSocket conectado com ID temporário: ${clientId}`);

  // Envia o clientId ao cliente para que ele possa armazenar
  ws.send(JSON.stringify({ type: "clientId", clientId }));

  ws.on("message", (message) => {
    let parsedMessage;

    try {
      parsedMessage = JSON.parse(message);
    } catch (e) {
      console.error("Mensagem JSON inválida recebida:", message);
      return;
    }

    // Se ainda não temos um clientId e o cliente enviou 'hello'
    if (!clientId && parsedMessage.type === "hello" && parsedMessage.clientId) {
      clientId = parsedMessage.clientId;
      console.log(`ClientId definido via hello: ${clientId}`);
      ws.send(JSON.stringify({ type: "clientId", clientId }));
      return;
    }

    // Se o cliente reaproveitou o clientId salvo, sobrescreve
    if (parsedMessage.clientId && typeof parsedMessage.clientId === "string") {
      clientId = parsedMessage.clientId;
      console.log(`Cliente reaproveitando clientId: ${clientId}`);
    }

    console.log(`Mensagem recebida do cliente [${clientId}]:`, parsedMessage);

    if (parsedMessage.type === "requestNewQr") {
      const qrId = uuidv4();
      qrCodeSessions.set(qrId, { wsClient: ws, status: "pending", clientId });
      ws.send(
        JSON.stringify({ type: "init", qrId, externalUrl: EXTERNAL_URL })
      );
      console.log(
        `Novo QR Code ${qrId} gerado e enviado para o cliente ${clientId}.`
      );
    } else if (parsedMessage.type === "resumeSession") {
      const { bikeId } = parsedMessage;
      const bike = bikes.get(bikeId);

      if (bike && bike.status === "em_uso" && bike.usuario_atual === clientId) {
        console.log(
          `Sessão da bicicleta ${bikeId} retomada para o cliente ${clientId}.`
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
          `Tentativa de retomar sessão falhou para bike ${bikeId} e cliente ${clientId}.`
        );
        console.log(
          `Bike status: ${bike ? bike.status : "N/A"}, Usuario atual: ${
            bike ? bike.usuario_atual : "N/A"
          }, Cliente ID: ${clientId}`
        );

        ws.send(JSON.stringify({ type: "clearClientStateAndRequestNewQr" }));

        const newQrId = uuidv4();
        qrCodeSessions.set(newQrId, {
          wsClient: ws,
          status: "pending",
          clientId,
        });
        ws.send(
          JSON.stringify({
            type: "init",
            qrId: newQrId,
            externalUrl: EXTERNAL_URL,
          })
        );
        console.log(
          `Novo QR Code ${newQrId} gerado e enviado para o cliente ${clientId} após falha na retomada da sessão.`
        );
      }
    }
  });

  ws.on("close", () => {
    console.log(`Cliente WebSocket [${clientId}] desconectado.`);
  });

  ws.on("error", (error) => {
    console.error(`Erro no WebSocket do cliente [${clientId}]:`, error);
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

// Endpoint para finalizar uso da bicicleta
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

    // NOTA IMPORTANTE: A SESSÃO WEBSOCKET DEVE SER NOTIFICADA ANTES DE LIMPAR qrId_atual
    // Senão, 'find' na linha 237 não encontra a sessão
    const sessionToNotify = Array.from(qrCodeSessions.values()).find(
      (s) => s.clientId === bike.usuario_atual // Encontra a sessão WebSocket que está vinculada a este usuário (cliente)
    );

    // Limpa o estado da bike no servidor
    bike.status = "disponivel";
    bike.qrId_atual = null; // Limpa DEPOIS de encontrar a sessão
    bike.usuario_atual = null;
    bike.hora_inicio_uso = null;
    bikes.set(bikeId, bike);

    // Notificar o cliente via WebSocket que o uso foi finalizado
    if (
      sessionToNotify &&
      sessionToNotify.wsClient &&
      sessionToNotify.wsClient.readyState === WebSocket.OPEN
    ) {
      sessionToNotify.wsClient.send(
        JSON.stringify({
          type: "usageEnded",
          bikeId: bikeId,
          tempoTotalMs: tempoTotalMs,
        })
      );
    }

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
  console.log(
    `Certifique-se de definir EXTERNAL_URL com sua URL do ngrok se for testar externamente.`
  );

  if (bikes.size === 0) {
    bikes.set("bike-001", {
      id: "bike-001",
      status: "disponivel",
      location: { lat: -24.0, lon: -46.0 },
      qrId_atual: null,
      usuario_atual: null,
      hora_inicio_uso: null,
    });
    bikes.set("bike-002", {
      id: "bike-002",
      status: "disponivel",
      location: { lat: -24.001, lon: -46.001 },
      qrId_atual: null,
      usuario_atual: null,
      hora_inicio_uso: null,
    });
    bikes.set("bike-003", {
      id: "bike-003",
      status: "manutencao",
      location: { lat: -24.002, lon: -46.002 },
      qrId_atual: null,
      usuario_atual: null,
      hora_inicio_uso: null,
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
