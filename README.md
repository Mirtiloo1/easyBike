# EASYBIKE

*Empowering seamless bike rentals, effortlessly connecting you.*

![last commit](https://img.shields.io/github/last-commit/mirtiloo/easyBike) ![html](https://img.shields.io/badge/html-37.8%25-blue) ![languages](https://img.shields.io/badge/languages-3-blue)

*Built with the tools and technologies:*

![Express](https://img.shields.io/badge/-Express-black) ![JSON](https://img.shields.io/badge/-JSON-lightgrey) ![npm](https://img.shields.io/badge/-npm-red) ![JavaScript](https://img.shields.io/badge/-JavaScript-yellow)

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Usage](#usage)

---

## Overview

**easyBike** is a powerful developer tool designed to streamline the creation of bike rental applications with real-time capabilities.

### Why easyBike?

This project empowers developers to build scalable and secure bike rental systems with ease. The core features include:

- 🚀 **Robust Server Management**: Utilizes Express.js for efficient server handling, simplifying server setup.
- 🔄 **Real-Time Communication**: Integrates WebSocket for seamless interactions, enhancing user experience.
- 🔐 **Secure User Authentication**: Implements bcryptjs for secure password handling, addressing security concerns.
- 🧠 **Efficient Database Interactions**: Supports PostgreSQL for reliable data storage and retrieval, ensuring performance.
- ✨ **Unique Identifier Generation**: Uses UUID for generating unique identifiers, simplifying entity management.
- 🧩 **Modular Architecture**: Organized structure promotes scalability and maintainability, making it easy to extend functionality.

---

## Getting Started

### Prerequisites

This project requires the following dependencies to be installed on your system:

- **Node.js**
- **npm** (Node Package Manager)
- **PostgreSQL**

---

### Installation

To get a local copy up and running, follow these simple steps.

1. **Clone the repository**:
    ```bash
    git clone [https://github.com/Mirtiloo/easyBike](https://github.com/Mirtiloo/easyBike)
    ```

2. **Navigate to the project directory**:
    ```bash
    cd easyBike
    ```

3. **Install dependencies**:
    ```bash
    npm install
    ```
4. **Set up environment variables**:
   - Create a `.env` file in the root of the project.
   - Add your database connection string and a session secret:
    ```env
    DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME
    SESSION_SECRET=your-super-secret-key-for-sessions
    ```

---

### Usage

1.  **Start the Local Server:**
    In the project directory, run the following command to start the Node.js server:
    ```bash
    node server.js
    ```
    You can also use the npm script if available:
    ```bash
    npm start
    ```
    The application will be running at `http://localhost:3000`.

2.  **Accessing via Ngrok (Optional):**
    To expose your local server to the internet for testing or demonstration, you can use ngrok.

    - First, [download and set up ngrok](https://ngrok.com/download) from the official website.
    - While your local server (`node server.js`) is running, open a **new terminal window**.
    - Run the following command to create a public tunnel to your local port 3000:
    ```bash
    ngrok http 3000
    ```
    - Ngrok will display a public forwarding URL (e.g., `https://xxxx-xxxx.ngrok-free.app`). Open this URL in your browser to access your application from anywhere.
