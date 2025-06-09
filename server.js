// server.js - VERSÃO COMPLETA E CORRIGIDA

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const session = require("express-session");

// --- INICIALIZAÇÃO E CONFIGURAÇÃO ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Variáveis de estado em memória
const bikes = new Map();
const activeWsClients = new Map();

// Configuração do Banco de Dados
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "easybike_db",
  password: "Cleison23!08",
  port: 5432,
});
pool.on("connect", () => console.log("Conectado ao banco de dados PostgreSQL."));
pool.on("error", (err) => console.error("Erro no banco de dados:", err.stack));

// Configuração da Sessão
app.use(
    session({
      secret: "sua-chave-secreta-super-segura-12345", // Troque por uma chave mais segura
      resave: false,
      saveUninitialized: true, // Importante para sessões de novos usuários
      cookie: {
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
      },
    })
);

// Middlewares do Express
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());


// --- MIDDLEWARE DE AUTENTICAÇÃO ---
// Verifica se o usuário está logado em rotas protegidas
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.status(401).json({ message: "Acesso não autorizado. Por favor, faça login." });
}


// --- LÓGICA DE WEBSOCKET (SIMPLIFICADA) ---

// Função para transmitir atualizações de status para todos os clientes do mapa
function broadcastBikeStatusUpdate(bikeId) {
  const bike = bikes.get(bikeId);
  if (!bike) return;

  const message = JSON.stringify({
    type: "bikeStatusUpdate",
    bikeId: bike.id,
    status: bike.status,
    location: bike.location,
    name: bike.name,
    // Envia o ID do usuário que está usando a bike para o frontend
    user_id_current: bike.user_id_current
  });

  activeWsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
  console.log(`Broadcast: Status da bike ${bikeId} atualizado para ${bike.status}.`);
}

wss.on("connection", (ws) => {
  const clientId = uuidv4();
  activeWsClients.set(clientId, ws);
  console.log(`Cliente de mapa [${clientId}] conectado. Total: ${activeWsClients.size}`);

  ws.on("message", (message) => {
    const parsedMessage = JSON.parse(message);

    // A única mensagem que o mapa precisa enviar é para pedir o estado inicial
    if (parsedMessage.type === "requestAllBikeStatuses") {
      const allBikesData = Array.from(bikes.values());
      ws.send(JSON.stringify({ type: "allBikeStatuses", bikes: allBikesData }));
    }
  });

  ws.on("close", () => {
    activeWsClients.delete(clientId);
    console.log(`Cliente de mapa [${clientId}] desconectado. Total: ${activeWsClients.size}`);
  });
});


// --- ROTAS DE USUÁRIO E AUTENTICAÇÃO ---

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
    if (err.code === "23505") { // Código para violação de chave única
      return res.status(409).json({ message: "Email já cadastrado." });
    }
    console.error("Erro ao cadastrar usuário:", err.stack);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email e senha são obrigatórios." });
  }
  try {
    const result = await pool.query( "SELECT * FROM users WHERE email = $1", [email] );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Email ou senha inválidos." });
    }
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.status(200).json({ message: "Login bem-sucedido!" });
  } catch (err) {
    console.error("Erro ao fazer login:", err.stack);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Erro ao fazer logout." });
    }
    res.clearCookie('connect.sid'); // Limpa o cookie da sessão
    res.status(200).json({ message: "Logout bem-sucedido." });
  });
});

app.get("/check-auth", (req, res) => {
  if (req.session.userId) {
    res.status(200).json({
      authenticated: true,
      userId: req.session.userId,
      userEmail: req.session.userEmail,
    });
  } else {
    res.status(200).json({ authenticated: false });
  }
});


// --- ROTAS DA API DE ALUGUEL DE BICICLETAS ---

// ROTA PARA O CLIENTE VERIFICAR SE JÁ POSSUI UM ALUGUEL ATIVO
app.get("/api/my-rental", isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query('SELECT id FROM bikes WHERE user_id_current = $1', [req.session.userId]);
    if (result.rows.length > 0) {
      res.json({ hasRental: true, bikeId: result.rows[0].id });
    } else {
      res.json({ hasRental: false });
    }
  } catch (error) {
    console.error("Erro ao verificar aluguel do usuário:", error);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

// ROTA PARA INICIAR O ALUGUEL (CHAMADA PELO BOTÃO NO MAPA)
app.post("/api/rent/:bikeId", isAuthenticated, async (req, res) => {
  const { bikeId } = req.params;
  const { userId } = req.session;

  try {
    const userRentalCheck = await pool.query('SELECT id FROM bikes WHERE user_id_current = $1', [userId]);
    if (userRentalCheck.rows.length > 0) {
      return res.status(409).json({ message: `Você já tem um aluguel ativo na bicicleta ${userRentalCheck.rows[0].id}.` });
    }

    const bikeResult = await pool.query('SELECT status FROM bikes WHERE id = $1', [bikeId]);
    const bike = bikeResult.rows[0];
    if (!bike || bike.status !== 'disponivel') {
      return res.status(409).json({ message: "Esta bicicleta não está disponível para aluguel." });
    }

    const usageStartTime = Date.now();
    await pool.query(
        "UPDATE bikes SET status = 'em_uso', user_id_current = $1, usage_start_time = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [userId, usageStartTime.toString(), bikeId]
    );

    const memoryBike = bikes.get(bikeId);
    if (memoryBike) {
      memoryBike.status = 'em_uso';
      memoryBike.user_id_current = userId;
      bikes.set(bikeId, memoryBike);
    }

    broadcastBikeStatusUpdate(bikeId);
    res.status(200).json({ message: "Bicicleta alugada com sucesso!"});

  } catch (error) {
    console.error(`Erro ao alugar bike ${bikeId}:`, error);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

// ROTA PARA FINALIZAR O ALUGUEL
app.post("/api/return/:bikeId", isAuthenticated, async (req, res) => {
  const { bikeId } = req.params;
  const { userId } = req.session;

  try {
    const bikeResult = await pool.query('SELECT status, user_id_current FROM bikes WHERE id = $1', [bikeId]);
    const bike = bikeResult.rows[0];

    if (!bike || bike.status !== 'em_uso') {
      return res.status(404).json({ message: "Bicicleta não encontrada ou não está em uso." });
    }

    if (bike.user_id_current !== userId) {
      return res.status(403).json({ message: "Ação não permitida. Você só pode devolver a sua própria bicicleta." });
    }

    await pool.query(
        "UPDATE bikes SET status = 'disponivel', user_id_current = NULL, usage_start_time = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [bikeId]
    );

    const memoryBike = bikes.get(bikeId);
    if (memoryBike) {
      memoryBike.status = 'disponivel';
      memoryBike.user_id_current = null;
      bikes.set(bikeId, memoryBike);
    }

    broadcastBikeStatusUpdate(bikeId);
    res.status(200).json({ message: "Bicicleta devolvida com sucesso!" });

  } catch (error) {
    console.error(`Erro ao finalizar uso da bike ${bikeId}:`, error);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});


// ROTA DE VERIFICAÇÃO DO QR CODE FÍSICO (CORRIGIDA)
app.get("/verify/:bikeId", (req, res) => {
  const { bikeId } = req.params;

  // CORREÇÃO: Usar crases (`) para a string de template, não barras (/).
  res.redirect(`/rental.html?bikeId=${bikeId}`);
});

// EM server.js, ADICIONE ESTA NOVA ROTA:
app.get("/api/rental-status/:bikeId", isAuthenticated, async (req, res) => {
  const { bikeId } = req.params;
  const { userId } = req.session;

  try {
    const result = await pool.query(
        'SELECT status, user_id_current, usage_start_time FROM bikes WHERE id = $1',
        [bikeId]
    );
    const bike = result.rows[0];

    if (bike && bike.status === 'em_uso' && bike.user_id_current === userId) {
      res.json({
        inUseByUser: true,
        startTime: bike.usage_start_time
      });
    } else {
      res.json({ inUseByUser: false });
    }
  } catch (error) {
    console.error("Erro ao verificar status do aluguel:", error);
    res.status(500).json({ message: "Erro interno do servidor." });
  }
});

// Adicione esta nova rota no server.js
app.get("/api/bike-info/:bikeId", (req, res) => {
  const { bikeId } = req.params;
  const bike = bikes.get(bikeId);
  if (bike) {
    res.status(200).json({ name: bike.name });
  } else {
    res.status(404).json({ message: "Bicicleta não encontrada" });
  }
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`Servidor rodando na porta ${PORT}`);

  // Carrega as bicicletas do banco de dados para a memória ao iniciar
  try {
    const client = await pool.connect();
    const dbResult = await client.query('SELECT * FROM bikes');

    for (const bike of dbResult.rows) {
      // Garante que cada bike tenha um QR Code Fixo no banco de dados
      if (!bike.qr_id_current) {
        const fixedQrId = uuidv4();
        await client.query('UPDATE bikes SET qr_id_current = $1 WHERE id = $2', [fixedQrId, bike.id]);
        bike.qr_id_current = fixedQrId; // Atualiza o objeto para o map em memória
        console.log(`QR Code fixo gerado e salvo para a bike ${bike.id}`);
      }

      // Popula o map em memória
      bikes.set(bike.id, {
        id: bike.id,
        name: bike.name,
        status: bike.status,
        location: { lat: parseFloat(bike.latitude), lon: parseFloat(bike.longitude) },
        qr_id_current: bike.qr_id_current,
        user_id_current: bike.user_id_current,
        usage_start_time: bike.usage_start_time,
      });
    }
    console.log(`${bikes.size} bicicletas carregadas do banco para a memória.`);
    client.release();
  } catch (err) {
    console.error("ERRO CRÍTICO ao inicializar o servidor e carregar as bicicletas:", err.stack);
  }
});