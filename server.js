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

const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const EXTERNAL_URL =
  process.env.EXTERNAL_URL || "https://7eb8-191-255-149-4.ngrok-free.app"; // Sua URL do ngrok

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "easybike_db",
  password: "3323",
  port: 5432,
});

pool.on("connect", () => {
  console.log("Conectado ao banco de dados PostgreSQL.");
});
pool.on("error", (err) => {
  console.error("Erro na conexão com o banco de dados PostgreSQL:", err.stack);
});

app.use(
  session({
    secret: "1a2b3c4d5e6f",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

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
            qrId: bike.qr_id_current,
            status: "verified",
            bikeId: bike.id,
            horaInicioUso: bike.usage_start_time,
          })
        );
      } else {
        console.log(
          `Tentativa de retomar sessão falhou para bike ${bikeId} e cliente ${connectionClientId}.`
        );
        console.log(
          `Bike status: ${
            bike ? bike.status : "N/A"
          }, Usuario atual (na bike): ${
            bike ? bike.usuario_atual : "N/A"
          }, Cliente ID atual da conexão: ${connectionClientId}`
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

// Rotas de Usuário (Cadastro, Login, etc.)
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email e senha são obrigatórios." });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, hashedPassword]
    );
    res.status(201).json({
      message: "Usuário cadastrado com sucesso!",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("Erro ao cadastrar usuário:", err.stack);
    if (err.code === "23505") {
      return res.status(409).json({ message: "Email já cadastrado." });
    }
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email e senha são obrigatórios." });
  }
  try {
    const result = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Email ou senha inválidos." });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Email ou senha inválidos." });
    }
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.status(200).json({
      message: "Login bem-sucedido!",
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error("Erro ao fazer login:", err.stack);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: "Não autenticado." });
  }
}

app.get("/dashboard", isAuthenticated, (req, res) => {
  res
    .status(200)
    .json({ message: `Bem-vindo ao dashboard, ${req.session.userEmail}!` });
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao fazer logout:", err);
      return res.status(500).json({ message: "Erro ao fazer logout." });
    }
    res.status(200).json({ message: "Logout bem-sucedido." });
  });
});

// Rota para verificar autenticação (já existente)
app.get("/check-auth", isAuthenticated, (req, res) => {
  res.status(200).json({
    authenticated: true,
    userEmail: req.session.userEmail,
  });
});

// Rota para logout (já existente)
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Erro ao fazer logout:", err);
      return res.status(500).json({ message: "Erro ao fazer logout." });
    }
    res.status(200).json({ message: "Logout bem-sucedido." });
  });
});

// Middleware modificado para verificação de autenticação
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    if (next) next();
    else return true;
  } else {
    if (req.path === "/check-auth") {
      return res.status(200).json({ authenticated: false });
    }
    res.status(401).json({ message: "Não autenticado." });
  }
}

app.get("/verify/:qrId", async (req, res) => {
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
        bike.qr_id_current = qrId;
        bike.usuario_atual = session.clientId;
        bike.usage_start_time = Date.now();
        bikes.set(bikeIdToAssign, bike);

        await pool.query(
          "UPDATE bikes SET status = $1, qr_id_current = $2, user_id_current = $3, usage_start_time = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5",
          ["em_uso", qrId, 1, bike.usage_start_time, bikeIdToAssign]
        );
        console.log(
          `Bicicleta ${bikeIdToAssign} atualizada no banco de dados para 'em_uso'.`
        );

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
              horaInicioUso: bike.usage_start_time,
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

app.post("/end-use/:bikeId", async (req, res) => {
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

    // Atualiza o banco de dados primeiro
    await pool.query(
      "UPDATE bikes SET status = $1, qr_id_current = NULL, user_id_current = NULL, usage_start_time = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      ["disponivel", bikeId]
    );
    console.log(
      `Bicicleta ${bikeId} atualizada no banco de dados para 'disponivel'.`
    );

    bike.status = "disponivel";
    bike.qr_id_current = null;
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

server.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(
    `Certifique-se de definir EXTERNAL_URL com sua URL do ngrok se for testar externamente.`
  );

  let initialBikesLoaded = false;
  try {
    const client = await pool.connect();
    const res = await client.query(
      "SELECT id, name, status, latitude, longitude, qr_id_current, user_id_current, usage_start_time FROM bikes"
    );
    res.rows.forEach((bike) => {
      bikes.set(bike.id, {
        id: bike.id,
        name: bike.name,
        status: bike.status,
        location: {
          lat: parseFloat(bike.latitude),
          lon: parseFloat(bike.longitude),
        },
        qr_id_current: bike.qr_id_current,
        usuario_atual: bike.user_id_current,
        hora_inicio_uso: bike.usage_start_time
          ? parseInt(bike.usage_start_time)
          : null,
      });
    });
    console.log(`Bicicletas carregadas do banco de dados: ${bikes.size}`);
    client.release();
    initialBikesLoaded = true;
  } catch (err) {
    console.error(
      "Erro ao carregar bicicletas do banco de dados (pode ser tabela vazia/inexistente):",
      err.stack
    );
    if (
      err.code === "42P01" ||
      err.message.includes("no rows in result set") ||
      err.message.includes('relation "bikes" does not exist')
    ) {
      console.log(
        "Tabela 'bikes' não encontrada ou vazia. Populando dados iniciais no banco de dados..."
      );
      const client = await pool.connect();
      try {
        await client.query(`
          INSERT INTO bikes (id, name, status, latitude, longitude) VALUES
          ('bike-001', 'Estação Fatec - Praça 19 de Janeiro - Boqueirão', 'disponivel', -24.004884, -46.412638),
          ('bike-002', 'Estação Tude Bastos - Rodoviária', 'disponivel', -23.999038, -46.413919),
          ('bike-003', 'Feirinha da Guilhermina - Av. Castelo Branco', 'manutencao', -24.013643, -46.42164),
          ON CONFLICT (id) DO NOTHING; -- Evita erro se já existir
        `);
        console.log(
          "Bicicletas iniciais inseridas no banco de dados (se não existiam)."
        );
      } catch (insertErr) {
        console.error(
          "Erro ao inserir dados iniciais no banco:",
          insertErr.stack
        );
      } finally {
        client.release();
      }
    }
  }
  try {
    const client = await pool.connect();
    const res = await client.query(
      "SELECT id, name, status, latitude, longitude, qr_id_current, user_id_current, usage_start_time FROM bikes"
    );
    bikes.clear();
    res.rows.forEach((bike) => {
      bikes.set(bike.id, {
        id: bike.id,
        name: bike.name,
        status: bike.status,
        location: {
          lat: parseFloat(bike.latitude),
          lon: parseFloat(bike.longitude),
        },
        qr_id_current: bike.qr_id_current,
        usuario_atual: bike.user_id_current,
        hora_inicio_uso: bike.usage_start_time
          ? parseInt(bike.usage_start_time)
          : null,
      });
    });
    console.log(
      `Map 'bikes' em memória populado/sincronizado com ${bikes.size} bikes do banco de dados.`
    );
    client.release();
  } catch (syncErr) {
    console.error(
      "Erro final ao sincronizar Map 'bikes' com o banco de dados:",
      syncErr.stack
    );
    if (bikes.size === 0) {
      console.warn(
        "Nenhuma bike carregada do DB. Populando Map 'bikes' com dados de fallback hardcoded."
      );
      bikes.set("bike-001", {
        id: "bike-001",
        status: "disponivel",
        location: { lat: -24.004884, lon: -46.412638 },
        qr_id_current: null,
        usuario_atual: null,
        hora_inicio_uso: null,
        name: "Estação Fatec - Praça 19 de Janeiro - Boqueirão",
      });
      bikes.set("bike-002", {
        id: "bike-002",
        status: "disponivel",
        location: { lat: -23.999038, lon: -46.413919 },
        qr_id_current: null,
        usuario_atual: null,
        hora_inicio_uso: null,
        name: "Estação Tude Bastos - Rodoviária",
      });
      bikes.set("bike-003", {
        id: "bike-003",
        status: "manutencao",
        location: { lat: -24.013643, lon: -46.42164 },
        qr_id_current: null,
        usuario_atual: null,
        hora_inicio_uso: null,
        name: "Feirinha da Guilhermina - Av. Castelo Branco",
      });
      console.log(
        "Map 'bikes' populado com dados de fallback hardcoded como último recurso."
      );
    }
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
