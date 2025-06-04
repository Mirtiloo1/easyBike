document.addEventListener("DOMContentLoaded", () => {
  const qrcodeDiv = document.getElementById("qrcode");
  const statusText = document.getElementById("status-text");
  const qrCodeContainer = document.getElementById("qrcode-container");
  const bikeUsageInfo = document.getElementById("bike-usage-info");
  const bikeIdDisplay = document.getElementById("bike-id-display");
  const timeElapsedSpan = document.getElementById("time-elapsed");
  const endUseButton = document.getElementById("end-use-button");

  let qr = null;
  let currentBikeId = null;
  let startTime = null;
  let timerInterval = null;

  // --- FUNÇÕES DE PERSISTÊNCIA COM LOCALSTORAGE ---
  function saveUsageState(bikeId, sTime) {
    localStorage.setItem("easyBike_currentBikeId", bikeId);
    localStorage.setItem("easyBike_startTime", sTime.toString());
    console.log("Estado de uso salvo no localStorage.");
  }

  function clearUsageState() {
    localStorage.removeItem("easyBike_currentBikeId");
    localStorage.removeItem("easyBike_startTime");
    console.log("Estado de uso limpo do localStorage.");
  }

  function loadUsageState() {
    const storedBikeId = localStorage.getItem("easyBike_currentBikeId");
    const storedStartTime = localStorage.getItem("easyBike_startTime");

    if (storedBikeId && storedStartTime) {
      currentBikeId = storedBikeId;
      startTime = parseInt(storedStartTime, 10);
      console.log("Estado de uso carregado do localStorage:", {
        currentBikeId,
        startTime,
      });
      return true;
    }
    return false;
  }
  // --- FIM DAS FUNÇÕES DE PERSISTÊNCIA ---

  // Conecta ao servidor WebSocket
  const ws = new ReconnectingWebSocket(`ws://${window.location.host}`);

  ws.onopen = () => {
    console.log("Conectado ao servidor WebSocket.");

    const savedClientId = localStorage.getItem("easyBike_clientId");
    if (savedClientId) {
      // Envia o clientId salvo antes de qualquer ação
      ws.send(JSON.stringify({ type: "hello", clientId: savedClientId }));
      console.log("ClientId reaproveitado enviado:", savedClientId);
    }

    // continua com o restante da lógica normalmente

    // Ao conectar, primeiro tenta retomar a sessão.
    // A visibilidade dos elementos será ajustada após a resposta do servidor.
    qrCodeContainer.style.display = "none";
    bikeUsageInfo.style.display = "none";

    if (loadUsageState()) {
      const clientId = localStorage.getItem("easyBike_clientId");
      ws.send(
        JSON.stringify({
          type: "resumeSession",
          bikeId: currentBikeId,
          clientId,
        })
      );

      statusText.textContent = `Status: Reconectando sessão para bicicleta ${currentBikeId}...`;
      statusText.className = "status-pending";
      // Mostra a tela de uso imediatamente com os dados do localStorage para uma transição mais suave
      bikeUsageInfo.style.display = "block";
      bikeIdDisplay.textContent = currentBikeId;
      startTimer(); // Reinicia o timer com o tempo salvo
    } else {
      // Se não há estado salvo, solicita um novo QR Code
      ws.send(JSON.stringify({ type: "requestNewQr" }));
      statusText.textContent = "Status: Conectado. Solicitando QR Code...";
      statusText.className = "status-pending";
    }
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Mensagem recebida do servidor:", message);

    if (message.type === "clientId") {
      if (!localStorage.getItem("easyBike_clientId")) {
        localStorage.setItem("easyBike_clientId", message.clientId);
        console.log("ClientId salvo pela primeira vez:", message.clientId);
      } else {
        console.log("ClientId já existente, ignorando novo:", message.clientId);
      }
    }

    if (message.type === "init") {
      const { qrId, externalUrl } = message;
      const qrCodeUrl = `${externalUrl}/verify/${qrId}`;
      console.log("URL para o QR Code:", qrCodeUrl);

      // 🔽 Adicione essa verificação antes de criar o novo QR Code
      if (qr && typeof qr.clear === "function") {
        qr.clear(); // limpa canvas SVG/canvas do QR anterior
      }
      qrcodeDiv.innerHTML = ""; // limpa HTML residual, por garantia

      qr = new QRCode(qrcodeDiv, {
        text: qrCodeUrl,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H,
      });

      statusText.textContent = "Status: QR Code gerado. Aguardando leitura...";
      statusText.className = "status-pending";
      qrCodeContainer.style.display = "block";
      bikeUsageInfo.style.display = "none";
    } else if (
      message.type === "statusUpdate" &&
      message.status === "verified"
    ) {
      currentBikeId = message.bikeId;
      startTime = message.horaInicioUso;

      saveUsageState(currentBikeId, startTime);

      statusText.textContent = "Status: QR Code UTILIZADO!";
      statusText.className = "status-verified";
      console.log(
        `QR Code marcado como usado! Bicicleta ${currentBikeId} liberada.`
      );

      qrCodeContainer.style.display = "none";
      bikeUsageInfo.style.display = "block";
      bikeIdDisplay.textContent = currentBikeId;

      startTimer();
    } else if (message.type === "usageEnded") {
      console.log(
        `Uso da bicicleta ${
          message.bikeId
        } finalizado. Tempo total: ${formatTime(message.tempoTotalMs)}.`
      );
      statusText.textContent =
        "Status: Uso finalizado. Bicicleta disponível novamente!";
      statusText.className = "status-pending";

      clearUsageState();

      stopTimer();
      timeElapsedSpan.textContent = "00:00:00";

      // Solicita um novo QR ao servidor para a próxima interação
      ws.send(JSON.stringify({ type: "requestNewQr" }));
      qrCodeContainer.style.display = "block";
      bikeUsageInfo.style.display = "none";
    } else if (message.type === "clearClientStateAndRequestNewQr") {
      console.log("Servidor solicitou limpeza de estado e novo QR.");
      clearUsageState();
      stopTimer();
      timeElapsedSpan.textContent = "00:00:00";
      // O servidor já enviou um 'init' logo após esta mensagem, então a UI será atualizada por ele.
      // Apenas garantimos que o estado local está limpo.
      statusText.textContent =
        "Status: Sessão inválida. Gerando novo QR Code...";
      statusText.className = "status-pending";
      // Oculta a info de uso, esperando o 'init' para mostrar o QR
      qrCodeContainer.style.display = "none";
      bikeUsageInfo.style.display = "none";
    }
  };

  ws.onclose = () => {
    console.log("Desconectado do servidor WebSocket.");
    statusText.textContent =
      "Status: Desconectado do servidor. Tentando reconectar...";
    statusText.className = "status-pending";
    // Não paramos o timer aqui para manter a contagem visível mesmo se a conexão cair,
    // o ReconnectingWebSocket tentará reconectar.
  };

  ws.onerror = (error) => {
    console.error("Erro no WebSocket:", error);
    statusText.textContent = "Status: Erro na conexão. Verifique o console.";
    statusText.className = "status-pending";
  };

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num) => num.toString().padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (startTime) {
        const elapsed = Date.now() - startTime;
        timeElapsedSpan.textContent = formatTime(elapsed);
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  endUseButton.addEventListener("click", async () => {
    if (currentBikeId) {
      try {
        const response = await fetch(`/end-use/${currentBikeId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const result = await response.json();
          console.log("Uso finalizado via botão:", result.message);
          // O servidor enviará uma mensagem WebSocket 'usageEnded', que será tratada no ws.onmessage
          clearUsageState();
          stopTimer();
          timeElapsedSpan.textContent = "00:00:00";
          qrCodeContainer.style.display = "block";
          bikeUsageInfo.style.display = "none";
          statusText.textContent =
            "Status: Uso finalizado. Bicicleta disponível novamente!";
          statusText.className = "status-pending";
        } else {
          const errorData = await response.json();
          console.error("Erro ao finalizar uso:", errorData.message);
          alert(`Erro ao finalizar uso: ${errorData.message}`);
        }
      } catch (error) {
        console.error("Erro de rede ao finalizar uso:", error);
        alert("Erro de conexão ao tentar finalizar o uso.");
      }
    } else {
      alert("Nenhuma bicicleta em uso para finalizar.");
    }
  });
});
