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
  let wsClientId = null;

  function saveUsageState(bikeId, sTime) {
    localStorage.setItem("easyBike_currentBikeId", bikeId);
    localStorage.setItem("easyBike_startTime", sTime.toString());
    localStorage.setItem("easyBike_lastWsClientId", wsClientId);
  }

  function clearUsageState() {
    localStorage.removeItem("easyBike_currentBikeId");
    localStorage.removeItem("easyBike_startTime");
    localStorage.removeItem("easyBike_lastWsClientId");
  }

  function loadUsageState() {
    const storedBikeId = localStorage.getItem("easyBike_currentBikeId");
    const storedStartTime = localStorage.getItem("easyBike_startTime");
    const storedClientId = localStorage.getItem("easyBike_lastWsClientId");

    if (storedBikeId && storedStartTime && storedClientId) {
      currentBikeId = storedBikeId;
      startTime = parseInt(storedStartTime, 10);
      wsClientId = storedClientId;
      return true;
    }
    return false;
  }

  const ws = new ReconnectingWebSocket(`ws://${window.location.host}`);

  ws.onopen = () => {
    statusText.textContent = "Status: Conectando...";
    statusText.className = "status-pending";
    qrCodeContainer.style.display = "none";
    bikeUsageInfo.style.display = "none";
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "serverClientId") {
      wsClientId = message.clientId;

      if (
        loadUsageState() &&
        wsClientId === localStorage.getItem("easyBike_lastWsClientId")
      ) {
        ws.send(
          JSON.stringify({
            type: "resumeSession",
            bikeId: currentBikeId,
            clientId: wsClientId,
          })
        );
        statusText.textContent = `Status: Reconectando sessão para bicicleta ${currentBikeId}...`;
        statusText.className = "status-pending";
        bikeUsageInfo.style.display = "block";
        bikeIdDisplay.textContent = currentBikeId;
        startTimer();
      } else {
        if (localStorage.getItem("easyBike_currentBikeId")) {
          console.warn("Estado local inconsistente. Limpando localStorage.");
        }
        clearUsageState();
        ws.send(JSON.stringify({ type: "requestNewQr" }));
        statusText.textContent = "Status: Conectado. Solicitando QR Code...";
        statusText.className = "status-pending";
        qrCodeContainer.style.display = "block";
        bikeUsageInfo.style.display = "none";
      }
    } else if (message.type === "init") {
      const { qrId, externalUrl } = message;
      const qrCodeUrl = `${externalUrl}/verify/${qrId}`;

      if (qr) {
        qr.clear();
        qr = null;
      }
      qrcodeDiv.innerHTML = "";

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

      qrCodeContainer.style.display = "none";
      bikeUsageInfo.style.display = "block";
      bikeIdDisplay.textContent = currentBikeId;

      startTimer();
    } else if (message.type === "usageEnded") {
      statusText.textContent =
        "Status: Uso finalizado. Bicicleta disponível novamente!";
      statusText.className = "status-pending";

      clearUsageState();
      stopTimer();
      timeElapsedSpan.textContent = "00:00:00";

      ws.send(JSON.stringify({ type: "requestNewQr" }));
      qrCodeContainer.style.display = "none";
      bikeUsageInfo.style.display = "none";
    } else if (message.type === "clearClientStateAndRequestNewQr") {
      clearUsageState();
      stopTimer();
      timeElapsedSpan.textContent = "00:00:00";
      statusText.textContent =
        "Status: Sessão inválida. Gerando novo QR Code...";
      statusText.className = "status-pending";
      qrCodeContainer.style.display = "none";
      bikeUsageInfo.style.display = "none";
    }
  };

  ws.onclose = () => {
    statusText.textContent =
      "Status: Desconectado do servidor. Tentando reconectar...";
    statusText.className = "status-pending";
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
          statusText.textContent = "Status: Finalizando uso localmente...";
          statusText.className = "status-pending";
          clearUsageState();
          stopTimer();
          timeElapsedSpan.textContent = "00:00:00";
          bikeUsageInfo.style.display = "none";
          qrCodeContainer.style.display = "none";
        } else {
          const errorData = await response.json();
          console.error("Erro ao finalizar uso (HTTP):", errorData.message);
          alert(`Erro ao finalizar uso: ${errorData.message}`);
          clearUsageState();
          ws.send(JSON.stringify({ type: "requestNewQr" }));
          statusText.textContent = "Status: Erro. Gerando novo QR Code...";
          statusText.className = "status-pending";
          qrCodeContainer.style.display = "none";
          bikeUsageInfo.style.display = "none";
        }
      } catch (error) {
        console.error("Erro de rede ao finalizar uso (Fetch):", error);
        alert("Erro de conexão ao tentar finalizar o uso.");
        clearUsageState();
        ws.send(JSON.stringify({ type: "requestNewQr" }));
        statusText.textContent =
          "Status: Erro de rede. Gerando novo QR Code...";
        statusText.className = "status-pending";
        qrCodeContainer.style.display = "none";
        bikeUsageInfo.style.display = "none";
      }
    } else {
      alert("Nenhuma bicicleta em uso para finalizar.");
    }
  });
});
