# Reppo ⚡

> **Minimalist Progressive Overload & Workout Tracker (PWA Mobile-First)**

**Reppo** é um sistema moderno, científico e enxuto para rastreamento de treinos de musculação, focado em **sobrecarga progressiva**, controle de esforço com **PSE (Percepção Subjetiva de Esforço / RPE)** e ajustes ergonômicos de máquinas.

Construído sem frameworks pesados, com zero dependências externas no backend e interface dark minimalista de alta performance.

---

## ✨ Funcionalidades Principais

- 📱 **Mobile-First & PWA:** Desenvolvido para uso real durante o treino no celular, com botões táteis largos, inputs otimizados para teclado numérico e suporte a instalação como aplicativo na tela de início.
- ⚡ **Sobrecarga Progressiva com IA:** Cálculo em tempo real de 1RM estimado (fórmula de Epley combinada com PSE/RIR). Previsão dinâmica de repetições ao digitar a carga na máquina.
- 🎯 **Escala PSE (Borg CR10 / RIR):** Avaliação de esforço subjetivo e repetições na reserva para garantir que cada série atinja a intensidade ideal de hipertrofia (PSE 7 a 9).
- ⚙️ **Ajustes de Máquinas e Equipamentos:** Registre a regulagem de banco, posição de pinos e pegadas de cada aparelho da sua academia.
- ⏱️ **Cronômetro de Descanso Flutuante:** Timers rápidos (30s, 60s, 90s, 2m, 3m) com sinal sonoro via Web Audio API.
- 🔒 **Screen Wake Lock API:** Mantém a tela do celular acesa durante toda a sessão de treino sem apagar sozinha.
- 📊 **Histórico & Gráficos Interativos:** Evolução de carga e tonelagem total com Chart.js.
- 🌐 **Rotinas Compartilhadas:** Crie suas fichas de treino ou clone rotinas públicas criadas por outros atletas.
- 🔐 **Autenticação Segura:** Criptografia com algoritmo nativo `crypto.scryptSync` e `salt` aleatório de 16 bytes por usuário.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
- **Node.js** (v18 ou superior) instalado.
- Zero pacotes npm para instalar (backend utiliza apenas módulos nativos: `http`, `crypto`, `fs`, `path`).

### Passo a Passo

1. **Clone o repositório:**
   ```bash
   git clone https://github.com/xaibelucas/reppo.git
   cd reppo
   ```

2. **Inicie o servidor:**
   ```bash
   node server.js
   ```

3. **Abra no navegador:**
   ```
   http://localhost:3000
   ```

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, Tailwind CSS, Lucide Icons, Chart.js, Vanilla JavaScript (ES6+).
- **Backend:** Node.js HTTP Server nativo (zero dependências npm).
- **Banco de Dados Local:** JSON Estruturado (`data.json`) / Suporte para nuvem (Supabase / PostgreSQL).
- **PWA:** Service Worker (`sw.js`) e `manifest.json`.

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.
