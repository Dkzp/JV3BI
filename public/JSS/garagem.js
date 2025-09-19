// garagem.js - VERSÃO ATUALIZADA

// ==================================================
//      GERENCIAMENTO DA GARAGEM & PERSISTÊNCIA (AGORA VIA API/MONGODB)
// ==================================================

const backendUrl = 'https://jv3bi.netlify.app'; // URL do seu backend
/** @type {Object.<string, CarroBase>} */
let garagem = {};

// Cache para a previsão do tempo
let previsaoProcessadaCompletaCache = null; 
let nomeCidadeCache = ""; 

/**
 * Carrega os veículos do banco de dados via API.
 */
async function carregarGaragem() {
    console.log("Buscando veículos no backend...");
    try {
        const response = await fetch(`${backendUrl}/api/garagem/veiculos`);
        if (!response.ok) {
            throw new Error(`Erro na rede: ${response.statusText}`);
        }
        const veiculosDoDB = await response.json();
        garagem = {}; // Limpa a garagem local antes de preencher

        if (veiculosDoDB && veiculosDoDB.length > 0) {
            for (const d of veiculosDoDB) {
                // O ID do mongo (_id) é o nosso ID do front
                const id = d._id; 
                if (!id || !d.modelo || !d.tipoVeiculo) {
                    console.warn(`Dados inválidos/incompletos para ID ${id} do DB. Pulando.`);
                    continue;
                }

                let veiculoInstance;
                const histRecriado = (d.historicoManutencao || [])
                    .map(m => (!m?.data || !m?.tipo) ? null : new Manutencao(m.data, m.tipo, m.custo, m.descricao))
                    .filter(m => m && m.validar());

                try {
                    // O primeiro argumento do construtor é o ID
                    const args = [id, d.modelo, d.cor, d.imagemSrc, d.placa, d.ano, d.dataVencimentoCNH];
                    switch (d.tipoVeiculo) {
                        case 'CarroEsportivo':
                            veiculoInstance = new CarroEsportivo(...args);
                            veiculoInstance.turboAtivado = d.turboAtivado || false;
                            break;
                        case 'Caminhao':
                            veiculoInstance = new Caminhao(...args, d.capacidadeCarga || 0);
                            veiculoInstance.cargaAtual = d.cargaAtual || 0;
                            break;
                        case 'CarroBase':
                        default:
                            veiculoInstance = new CarroBase(...args);
                            break;
                    }
                    // Estados voláteis que não salvamos no DB
                    veiculoInstance.velocidade = 0; 
                    veiculoInstance.ligado = false;
                    veiculoInstance.historicoManutencao = histRecriado;
                    garagem[id] = veiculoInstance;

                } catch (creationError) {
                    console.error(`Erro crítico ao recriar instância do veículo ${id}. Pulando.`, creationError, d);
                }
            }
            console.log("Garagem carregada do Banco de Dados com sucesso!");
        } else {
             console.log("Nenhum veículo encontrado no banco de dados. A garagem está vazia.");
        }
    } catch (e) {
        console.error("ERRO GRAVE ao carregar garagem do backend:", e);
        alert("Não foi possível carregar os dados da garagem do servidor. Verifique se o backend está rodando e o console para mais detalhes.");
        garagem = {};
    }
    
    // Após carregar, atualiza a interface
    atualizarInterfaceCompleta();
}

// ==================================================
//      ATUALIZAÇÃO DA INTERFACE GERAL (UI)
// ==================================================
function atualizarInterfaceCompleta() {
    console.log("Atualizando interface completa...");
    atualizarMenuVeiculos();
    atualizarExibicaoAgendamentosFuturos();
    verificarVencimentoCNH();
    verificarAgendamentosProximos();

    const veiculosIds = Object.keys(garagem);
    const displayArea = document.getElementById('veiculo-display-area');
    const idVeiculoAtual = displayArea?.dataset.veiculoId;

    if (veiculosIds.length === 0) {
        limparAreaDisplay(true);
    } else {
        if (idVeiculoAtual && garagem[idVeiculoAtual]) {
             marcarBotaoAtivo(idVeiculoAtual);
             if (displayArea.querySelector('.veiculo-renderizado')) {
                 garagem[idVeiculoAtual].atualizarInformacoesUI("Atualização Completa");
             } else {
                 renderizarVeiculo(idVeiculoAtual);
             }
        } else {
             const primeiroId = veiculosIds[0] || null;
             if(primeiroId){
                marcarBotaoAtivo(primeiroId);
                renderizarVeiculo(primeiroId);
             } else {
                limparAreaDisplay(true);
             }
        }
    }
    console.log("Interface completa atualizada.");
}

function limparAreaDisplay(mostrarMsgGaragemVazia = false) {
    const displayArea = document.getElementById('veiculo-display-area');
    if (displayArea) {
        const msg = mostrarMsgGaragemVazia ?
            '<div class="placeholder"><i class="fa-solid fa-warehouse"></i> Garagem vazia. Adicione um veículo!</div>' :
            '<div class="placeholder"><i class="fa-solid fa-hand-pointer"></i> Selecione um veículo no menu acima.</div>';
        displayArea.innerHTML = msg;
        delete displayArea.dataset.veiculoId;
    }
}

function atualizarMenuVeiculos() {
    const menu = document.getElementById('menu-veiculos');
    if (!menu) return;
    menu.innerHTML = '';
    const ids = Object.keys(garagem);

    if (ids.length === 0) {
        menu.innerHTML = '<span class="empty-placeholder">Sua garagem está vazia <i class="fa-regular fa-face-sad-tear"></i></span>';
        return;
    }
    ids.sort((a, b) => (garagem[a]?.modelo || '').localeCompare(garagem[b]?.modelo || ''));
    ids.forEach(id => {
        const v = garagem[id];
        if (v) {
            const btn = document.createElement('button');
            btn.textContent = v.modelo || `Veículo ${id}`;
            btn.dataset.veiculoId = id;
            btn.title = `${v.modelo || '?'} (${v.placa || 'S/P'}) - ${v.ano || '?'}`;
            btn.addEventListener('click', () => {
                marcarBotaoAtivo(id);
                renderizarVeiculo(id);
            });
            menu.appendChild(btn);
        }
    });
}

function marcarBotaoAtivo(id) {
    document.querySelectorAll('#menu-veiculos button').forEach(b => {
        b.classList.toggle('veiculo-ativo', b.dataset.veiculoId === id);
    });
}
// ==================================================
//       RENDERIZAÇÃO DINÂMICA DO VEÍCULO (Template)
// ==================================================
function renderizarVeiculo(veiculoId) {
    const veiculo = garagem[veiculoId];
    const displayArea = document.getElementById('veiculo-display-area');
    const template = document.getElementById('veiculo-template');

    if (!veiculo || !displayArea || !template || !(template instanceof HTMLTemplateElement)) {
        console.error(`Erro ao tentar renderizar ${veiculoId}: Pré-requisitos inválidos.`);
        limparAreaDisplay();
        return;
    }
    console.log(`Renderizando veículo: ${veiculo.modelo} (ID: ${veiculoId})`);
    const clone = template.content.cloneNode(true);
    const container = clone.querySelector('.veiculo-renderizado');
    if (!container) {
         console.error("Estrutura do #veiculo-template inválida.");
         return;
    }
    container.dataset.templateId = veiculoId; 

    container.querySelectorAll('.acoes-veiculo button[data-acao]').forEach(btn => {
        const acao = btn.dataset.acao;
        if (acao && !['ativarTurbo', 'carregar'].includes(acao)) {
             btn.addEventListener('click', () => interagirVeiculoAtual(acao));
        }
    });

    container.querySelector('.btn-excluir-veiculo')?.addEventListener('click', () => handleExcluirVeiculo(veiculoId));
    container.querySelector('.salvar-veiculo-btn')?.addEventListener('click', () => handleSalvarEdicaoVeiculo(veiculoId));
    container.querySelector('.btn-limpar-historico')?.addEventListener('click', () => handleLimparHistorico(veiculoId));
    container.querySelector('.form-agendamento')?.addEventListener('submit', (e) => handleAgendarManutencao(e, veiculoId));

    // --- LÓGICA PARA DETALHES EXTRAS (EDITÁVEL) ---
    const btnDetalhes = container.querySelector('.btn-detalhes-extras');
    const areaDetalhes = container.querySelector('.detalhes-extras-area');
    const btnEditar = container.querySelector('.btn-editar-detalhes');
    
    areaDetalhes.innerHTML = '<p>Clique no botão acima para carregar os detalhes.</p>';
    btnEditar.style.display = 'none';
    btnEditar.onclick = null;
    
    if (btnDetalhes && areaDetalhes && btnEditar) {
        btnDetalhes.addEventListener('click', async () => {
            areaDetalhes.innerHTML = '<p><i class="fa-solid fa-spinner fa-spin"></i> Carregando detalhes...</p>';
            btnDetalhes.disabled = true;
            btnEditar.style.display = 'none';

            try {
                const detalhes = await buscarDetalhesVeiculoAPI(veiculoId);
                exibirDetalhesExtras(detalhes, areaDetalhes, veiculoId);
            } catch (error) {
                console.error("Erro no listener do botão de detalhes:", error);
                areaDetalhes.innerHTML = `<p style="color:red;"><i class="fa-solid fa-bomb"></i> Erro ao buscar detalhes: ${error.message}</p>`;
            } finally {
                 btnDetalhes.disabled = false;
            }
        });
    }

    const editImgInput = container.querySelector('.edit-imagem-input');
    const editImgPreview = container.querySelector('.edit-imagem-preview');
    if (editImgInput && editImgPreview) {
        editImgInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file && file.type.startsWith("image/")) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    editImgPreview.src = e.target.result;
                    editImgPreview.style.display = 'block';
                };
                reader.onerror = () => { editImgPreview.src = '#'; editImgPreview.style.display = 'none'; };
                reader.readAsDataURL(file);
            } else { editImgPreview.src = '#'; editImgPreview.style.display = 'none'; }
        });
    }

    const acaoExtraEl = container.querySelector('.acao-extra');
    if (acaoExtraEl) {
        acaoExtraEl.innerHTML = '';
        if (veiculo instanceof CarroEsportivo) {
            const btn = document.createElement('button');
            btn.dataset.acao = 'ativarTurbo';
            btn.innerHTML = `<i class="fa-solid fa-bolt"></i> Turbo`; 
            btn.title = "Ativar/Desativar Turbo";
            btn.classList.add('btn-turbo');
            btn.addEventListener('click', () => interagirVeiculoAtual('ativarTurbo'));
            acaoExtraEl.appendChild(btn);
        } else if (veiculo instanceof Caminhao) {
            const div = document.createElement('div');
            div.className = 'carga-container';
            const inputId = `carga-input-${veiculoId}`;
            div.innerHTML = `
                <label for="${inputId}" style="margin-bottom:0; color: #ecf0f1;">Carga(kg):</label>
                <input type="number" min="1" id="${inputId}" class="carga-input" placeholder="Ex: 500">
                <button data-acao="carregar" title="Adicionar Carga"><i class="fa-solid fa-truck-ramp-box"></i> Carregar</button>`;
            const cargaBtn = div.querySelector('button[data-acao="carregar"]');
            const inputCarga = div.querySelector('input.carga-input');
            if (cargaBtn && inputCarga) {
                cargaBtn.addEventListener('click', () => interagirVeiculoAtual('carregar', inputCarga));
                inputCarga.addEventListener('keypress', (e) => { if(e.key === 'Enter') interagirVeiculoAtual('carregar', inputCarga); });
            }
            acaoExtraEl.appendChild(div);
        }
    }

    displayArea.innerHTML = '';
    displayArea.appendChild(clone);
    displayArea.dataset.veiculoId = veiculoId;
    veiculo.atualizarInformacoesUI("Renderização Completa");
}

// ==================================================
//       INTERAÇÃO COM O VEÍCULO ATUALMENTE EXIBIDO
// ==================================================
function interagirVeiculoAtual(acao, extraElement = null) {
    const displayArea = document.getElementById('veiculo-display-area');
    const veiculoId = displayArea?.dataset.veiculoId;
    if (veiculoId && garagem[veiculoId]) {
        if (acao === 'carregar' && extraElement instanceof HTMLInputElement) {
            interagir(veiculoId, acao, extraElement.value);
            extraElement.value = '';
        } else {
            interagir(veiculoId, acao);
        }
    } else {
        alert("Por favor, selecione um veículo válido primeiro.");
    }
}

function interagir(veiculoId, acao, arg = null) {
    const v = garagem[veiculoId];
    if (!v) return;
    console.log(`Interagir: Ação=${acao}, Veículo=${veiculoId} (${v.modelo}), Arg=${arg}`);
    try {
        switch (acao) {
            case 'ligar': v.ligar(); break;
            case 'desligar': v.desligar(); break;
            case 'acelerar': v.acelerar(); break;
            case 'frear': v.frear(); break;
            case 'buzinar': v.buzinar(); break;
            case 'ativarTurbo':
                if (v instanceof CarroEsportivo) v.ativarTurbo();
                else v.notificarUsuario("Ação 'Turbo' apenas para Carros Esportivos.");
                break;
            case 'carregar':
                if (v instanceof Caminhao) v.carregar(arg);
                else v.notificarUsuario("Ação 'Carregar' apenas para Caminhões.");
                break;
            default:
                if (!['buscar-detalhes', 'salvar-edicao', 'excluir', 'editar-detalhes'].includes(acao)) {
                    console.warn(`Ação desconhecida ou não manipulada centralmente: ${acao}`);
                }
        }
    } catch (e) {
        console.error(`Erro ao executar ação '${acao}' no veículo ${veiculoId}:`, e);
        alert(`Ocorreu um erro ao tentar ${acao}. Verifique o console.`);
    }
}
// ==================================================
//          HANDLERS DE EVENTOS GLOBAIS / FORMULÁRIOS
// ==================================================
function handleTrocarAba(abaId) {
    document.querySelectorAll('.secao-principal').forEach(s => s.classList.remove('ativa'));
    document.querySelectorAll('#abas-navegacao button').forEach(b => b.classList.remove('aba-ativa'));
    const secaoId = abaId === 'tab-garagem' ? 'secao-garagem' : 'secao-adicionar';
    document.getElementById(secaoId)?.classList.add('ativa');
    document.getElementById(abaId)?.classList.add('aba-ativa');
}

/**
 * Pega os dados do formulário e envia para a API salvar no DB.
 */
function handleAdicionarVeiculo(event) {
    event.preventDefault();
    const form = event.target;
    const btnSubmit = form.querySelector('#adicionar-veiculo-btn');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    const mod = form.querySelector('#add-modelo').value.trim();
    const cor = form.querySelector('#add-cor').value.trim();
    const plc = form.querySelector('#add-placa').value.trim().toUpperCase();
    const ano = form.querySelector('#add-ano').value;
    const tipo = form.querySelector('#add-tipo').value;
    const capIn = form.querySelector('#add-capacidade-carga');
    const capCg = (tipo === 'Caminhao' && capIn) ? capIn.value : 0;
    const dtCnh = form.querySelector('#add-cnh').value;
    const imgInput = form.querySelector('#add-imagem-input');

    if (!mod || !tipo) {
        alert("Modelo e Tipo são obrigatórios!");
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Adicionar à Garagem';
        return;
    }
    
    // Cria um ID único no frontend para usar no DB
    const nId = `v${Date.now()}`; 

    const criarEAdicionarVeiculo = async (imagemSrc = null) => {
        try {
            let imgFinal = imagemSrc;
            if (!imgFinal) { // Define imagem padrão se nenhuma foi enviada
                switch (tipo) {
                    case 'CarroEsportivo': imgFinal = 'default_sport.png'; break;
                    case 'Caminhao': imgFinal = 'default_truck.png'; break;
                    default: imgFinal = 'default_car.png'; break;
                }
            }
            
            // Instancia a classe correta no frontend
            let nV;
            const args = [nId, mod, cor, imgFinal, plc, ano, dtCnh || null];
            switch (tipo) {
                case 'CarroEsportivo': nV = new CarroEsportivo(...args); break;
                case 'Caminhao': nV = new Caminhao(...args, capCg); break;
                default: nV = new CarroBase(...args); break;
            }

            // Converte o objeto da classe em JSON para enviar
            const dadosParaAPI = nV.toJSON();
            
            // Envia para o backend
            const response = await fetch(`${backendUrl}/api/garagem/veiculos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dadosParaAPI)
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Erro do servidor: ${response.statusText}`);
            }

            const veiculoSalvo = await response.json();
            
            // Sucesso! Atualiza a garagem local e a interface
            garagem[veiculoSalvo._id] = nV; // Usa o ID retornado pelo DB
            
            atualizarMenuVeiculos();
            form.reset();
            document.getElementById('add-capacidade-carga-container').style.display = 'none';
            const imgPreview = document.getElementById('add-imagem-preview');
            if(imgPreview) { imgPreview.src='#'; imgPreview.style.display='none'; }
            if(imgInput) imgInput.value = '';
            
            handleTrocarAba('tab-garagem');
            marcarBotaoAtivo(veiculoSalvo._id);
            renderizarVeiculo(veiculoSalvo._id);
            alert(`Veículo "${mod}" adicionado com sucesso ao banco de dados!`);

        } catch (e) {
            console.error("Erro ao adicionar veículo via API:", e);
            alert(`Erro ao adicionar veículo: ${e.message}`);
        } finally {
            // Reabilita o botão, independentemente do resultado
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Adicionar à Garagem';
        }
    };

    const file = imgInput?.files[0];
    if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => criarEAdicionarVeiculo(e.target.result);
        reader.onerror = () => {
            alert("Houve um erro ao processar a imagem. O veículo será adicionado com a imagem padrão.");
            criarEAdicionarVeiculo(null);
        };
        reader.readAsDataURL(file);
    } else {
        criarEAdicionarVeiculo(null);
    }
}

/**
 * Coleta os dados do formulário de edição, envia para a API via PUT e atualiza a UI.
 * @param {string} veiculoId - O ID do veículo sendo editado.
 */
async function handleSalvarEdicaoVeiculo(veiculoId) {
    const v = garagem[veiculoId];
    if (!v) return;

    const displayArea = document.getElementById('veiculo-display-area');
    const container = displayArea?.querySelector(`.veiculo-renderizado[data-template-id="${veiculoId}"]`);
    if (!container) {
        alert("Erro: Não foi possível encontrar a área de edição do veículo.");
        return;
    }

    const btnSalvar = container.querySelector('.salvar-veiculo-btn');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    // Coleta dos dados do formulário de edição
    const modelo = container.querySelector('.edit-modelo-veiculo').value.trim();
    const cor = container.querySelector('.edit-cor-veiculo').value.trim();
    const placa = container.querySelector('.edit-placa-veiculo').value.trim().toUpperCase();
    const ano = container.querySelector('.edit-ano-veiculo').value;
    const dataCnh = container.querySelector('.edit-cnh-veiculo').value;
    const imagemInput = container.querySelector('.edit-imagem-input');

    // Função interna para processar o salvamento após a imagem ser lida (ou não)
    const proceedWithSave = async (novaImagemSrc) => {
        try {
            // Atualiza o objeto local primeiro
            v.modelo = modelo;
            v.cor = cor;
            v.placa = placa;
            v.ano = ano ? parseInt(ano) : null;
            // Recria o objeto Date para garantir a validação
            v.dataVencimentoCNH = dataCnh ? new Date(dataCnh + 'T00:00:00Z') : null;
            if (novaImagemSrc) {
                v.imagemSrc = novaImagemSrc;
            }

            // Prepara os dados para enviar à API
            const dadosParaAPI = v.toJSON();

            // Envia a requisição PUT para o backend
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dadosParaAPI)
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Erro do servidor ao salvar.');
            }
            
            alert(`Veículo "${v.modelo}" atualizado com sucesso!`);
            v.atualizarInformacoesUI("Edição Salva");
            atualizarMenuVeiculos(); // Atualiza o nome no menu, se mudou
            marcarBotaoAtivo(veiculoId);
            verificarVencimentoCNH(); // Re-checa alertas de CNH

        } catch (error) {
            console.error("Erro ao salvar edição do veículo:", error);
            alert(`Falha ao salvar alterações: ${error.message}`);
        } finally {
            btnSalvar.disabled = false;
            btnSalvar.innerHTML = '<i class="fa-solid fa-save"></i> Salvar Alterações';
        }
    };

    // Lógica para ler a nova imagem, se houver
    const file = imagemInput?.files[0];
    if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => proceedWithSave(e.target.result); // Chama o save com a imagem em Base64
        reader.onerror = () => {
            alert("Erro ao ler a nova imagem. A alteração da imagem será ignorada.");
            proceedWithSave(null); // Prossegue sem alterar a imagem
        };
        reader.readAsDataURL(file);
    } else {
        proceedWithSave(null); // Prossegue sem alterar a imagem
    }
}

async function handleAgendarManutencao(event, veiculoId) {
    event.preventDefault();
    const v = garagem[veiculoId];
    if (!v) return;
    
    const form = event.target;
    const btnAgendar = form.querySelector('.agendar-manutencao-btn');
    btnAgendar.disabled = true;
    btnAgendar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Agendando...';

    const dataInput = form.querySelector('.agendamento-data');
    const horaInput = form.querySelector('.agendamento-hora');
    const tipoInput = form.querySelector('.agendamento-tipo');
    const custoInput = form.querySelector('.agendamento-custo');
    const obsInput = form.querySelector('.agendamento-obs');

    const dataStr = dataInput.value;
    const horaStr = horaInput?.value || '00:00';
    const tipoStr = tipoInput.value.trim();
    
    if(!dataStr || !tipoStr) {
        alert("Data e Tipo de Serviço são obrigatórios!");
        btnAgendar.disabled = false;
        btnAgendar.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Agendar Serviço';
        return;
    }

    const custoStr = custoInput?.value;
    const obsStr = obsInput?.value.trim();
    const dataHoraCompleta = new Date(`${dataStr}T${horaStr}`);

    const novaManutencao = new Manutencao(dataHoraCompleta, tipoStr, custoStr, obsStr);

    if(!novaManutencao.validar()){
        alert("Os dados do agendamento são inválidos. Verifique a data e o tipo.");
        btnAgendar.disabled = false;
        btnAgendar.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Agendar Serviço';
        return;
    }
    
    v.historicoManutencao.push(novaManutencao);
    v.historicoManutencao.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

    try {
        const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(v.toJSON())
        });

        if (!response.ok) {
            v.historicoManutencao.shift(); // Remove o item recém-adicionado se a API falhar
            const errData = await response.json();
            throw new Error(errData.error || 'Erro do servidor');
        }

        alert("Serviço agendado e salvo com sucesso!");
        v.atualizarInformacoesUI("Manutenção Adicionada");
        atualizarExibicaoAgendamentosFuturos();
        verificarAgendamentosProximos();
        form.reset();
    } catch (error) {
        console.error("Erro ao agendar manutenção:", error);
        alert(`Falha ao agendar serviço: ${error.message}`);
    } finally {
        btnAgendar.disabled = false;
        btnAgendar.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Agendar Serviço';
    }
}


/**
 * Limpa o histórico de manutenção de um veículo, salva a alteração no backend e atualiza a UI.
 * @param {string} veiculoId - O ID do veículo.
 */
async function handleLimparHistorico(veiculoId) {
    const v = garagem[veiculoId];
    if (!v) return;

    if (confirm(`Tem certeza que deseja limpar TODO o histórico de mimos para o veículo "${v.modelo}"? Esta ação não pode ser desfeita.`)) {
        const displayArea = document.getElementById('veiculo-display-area');
        const btnLimpar = displayArea?.querySelector(`.veiculo-renderizado[data-template-id="${veiculoId}"] .btn-limpar-historico`);
        if(btnLimpar) {
            btnLimpar.disabled = true;
            btnLimpar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        const historicoAntigo = [...v.historicoManutencao];
        v.historicoManutencao = [];

        try {
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(v.toJSON())
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Erro do servidor ao limpar histórico.');
            }
            
            alert('Histórico de manutenção limpo e salvo com sucesso!');
            v.atualizarInformacoesUI("Histórico Limpo");
            atualizarExibicaoAgendamentosFuturos();
            verificarAgendamentosProximos();

        } catch (error) {
            console.error("Erro ao limpar histórico:", error);
            alert(`Falha ao limpar histórico: ${error.message}`);
            v.historicoManutencao = historicoAntigo;
        } finally {
             if(btnLimpar) {
                btnLimpar.disabled = false;
                btnLimpar.innerHTML = '<i class="fa-solid fa-eraser"></i> Limpar';
            }
        }
    }
}


/**
 * Exclui um veículo do backend e, se bem-sucedido, da garagem local, atualizando a UI.
 * @param {string} veiculoId - O ID do veículo a ser excluído.
 */
async function handleExcluirVeiculo(veiculoId) {
    const v = garagem[veiculoId];
    if (!v) return;

    if (confirm(`Tem certeza que deseja excluir o veículo "${v.modelo}" da sua garagem?`)) {
        const displayArea = document.getElementById('veiculo-display-area');
        const btnExcluir = displayArea?.querySelector(`.veiculo-renderizado[data-template-id="${veiculoId}"] .btn-excluir-veiculo`);
         if(btnExcluir) {
            btnExcluir.disabled = true;
            btnExcluir.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        try {
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Erro do servidor ao excluir.');
            }
            
            alert(`Veículo "${v.modelo}" excluído com sucesso.`);
            delete garagem[veiculoId];
            atualizarInterfaceCompleta();

        } catch (error) {
            console.error("Erro ao excluir veículo:", error);
            alert(`Falha ao excluir veículo: ${error.message}`);
            if(btnExcluir) {
                btnExcluir.disabled = false;
                btnExcluir.innerHTML = '<i class="fa-solid fa-trash-can"></i> Excluir Veículo';
            }
        }
    }
}

// ==================================================
//      ALERTAS E VISUALIZAÇÕES GERAIS
// ==================================================
function atualizarExibicaoAgendamentosFuturos() {
    const divLista = document.getElementById('agendamentos-futuros-lista');
    if (!divLista) return;
    const agora = new Date();
    let todosAgendamentos = [];
    Object.values(garagem).forEach(v => {
        (v.historicoManutencao || [])
            .filter(m => m instanceof Manutencao && m.data instanceof Date && !isNaN(m.data) && m.data > agora)
            .forEach(m => todosAgendamentos.push({ manutencao: m, veiculoModelo: v.modelo, veiculoId: v.id }));
    });
    todosAgendamentos.sort((a, b) => a.manutencao.data.getTime() - b.manutencao.data.getTime());
    if (todosAgendamentos.length > 0) {
        const listaHtml = todosAgendamentos.map(item =>
            `<li title="Clique para ver ${item.veiculoModelo}" data-link-veiculo="${item.veiculoId}">
               <strong>${item.veiculoModelo}:</strong> ${item.manutencao.formatarComHora()}
             </li>`
        ).join('');
        divLista.innerHTML = `<ul>${listaHtml}</ul>`;
        divLista.querySelector('ul')?.addEventListener('click', handleCliqueLinkVeiculo);
    } else {
        divLista.innerHTML = '<p>Nenhum agendamento futuro encontrado.</p>';
    }
}

function verificarAgendamentosProximos() {
    const areaNotif = document.getElementById('notificacoes-area');
    if (!areaNotif) return;
    const agora = new Date();
    const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0);
    const fimDeAmanha = new Date(agora); fimDeAmanha.setDate(agora.getDate() + 1); fimDeAmanha.setHours(23, 59, 59, 999);
    let notificacoes = [];
    Object.values(garagem).forEach(v => {
        (v.historicoManutencao || [])
            .filter(m => m instanceof Manutencao && m.data instanceof Date && !isNaN(m.data) &&
                          m.data >= inicioHoje && m.data <= fimDeAmanha)
            .forEach(m => {
                const ehHoje = m.data.toDateString() === agora.toDateString();
                const prefixo = ehHoje ? "🚨 HOJE" : "🗓️ Amanhã";
                const horaFormatada = m.data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                notificacoes.push({
                    html: `<li title="Clique para ver ${v.modelo}" data-link-veiculo="${v.id}">${prefixo}: <strong>${v.modelo}</strong> - ${m.tipo} às ${horaFormatada}</li>`,
                    ehHoje: ehHoje, data: m.data
                });
            });
    });
    notificacoes.sort((a, b) => {
        if (a.ehHoje !== b.ehHoje) return a.ehHoje ? -1 : 1;
        return a.data.getTime() - b.data.getTime();
    });
    if (notificacoes.length > 0) {
        areaNotif.innerHTML = `<h4><i class="fa-solid fa-bell fa-shake" style="color: #ffc107;"></i> Alertas Manutenção Próxima</h4><ul>${notificacoes.map(n => n.html).join('')}</ul>`;
        areaNotif.style.display = 'block';
        areaNotif.querySelector('ul')?.addEventListener('click', handleCliqueLinkVeiculo);
    } else {
        areaNotif.innerHTML = ''; areaNotif.style.display = 'none';
    }
}

function verificarVencimentoCNH() {
    const areaCnh = document.getElementById('cnh-alertas-area');
    if (!areaCnh) return;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    let alertasCnh = [];
    Object.values(garagem).forEach(v => {
        if (v.dataVencimentoCNH instanceof Date && !isNaN(v.dataVencimentoCNH.getTime())) {
            const dataVenc = v.dataVencimentoCNH;
            const diffTime = dataVenc.getTime() - hoje.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const dataFormatada = dataVenc.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
            let statusHtml = ''; let prioridade = 3;
            if (diffDays < 0) {
                statusHtml = `<span class="cnh-status cnh-vencida">VENCIDA (${dataFormatada})!</span>`; prioridade = 1;
            } else if (diffDays <= 30) {
                statusHtml = `<span class="cnh-status cnh-vence-breve">Vence em ${diffDays}d (${dataFormatada})!</span>`; prioridade = 2;
            }
            if (statusHtml) {
                alertasCnh.push({
                    html: `<li title="Clique para ver ${v.modelo}" data-link-veiculo="${v.id}"><strong>${v.modelo} (${v.placa || 'S/P'}):</strong> CNH ${statusHtml}</li>`,
                    prioridade: prioridade, diffDays: diffDays
                });
            }
        }
    });
    alertasCnh.sort((a, b) => {
        if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
        return a.diffDays - b.diffDays;
    });
    if (alertasCnh.length > 0) {
        areaCnh.innerHTML = `<h4><i class="fa-solid fa-id-card-clip"></i> Alertas de CNH</h4><ul>${alertasCnh.map(a => a.html).join('')}</ul>`;
        areaCnh.style.display = 'block';
        areaCnh.querySelector('ul')?.addEventListener('click', handleCliqueLinkVeiculo);
    } else {
        areaCnh.innerHTML = ''; areaCnh.style.display = 'none';
    }
}

function handleCliqueLinkVeiculo(event) {
    const targetLi = event.target.closest('li[data-link-veiculo]');
    if (targetLi) {
        const veiculoId = targetLi.dataset.linkVeiculo;
        if (garagem[veiculoId]) {
            handleTrocarAba('tab-garagem');
            marcarBotaoAtivo(veiculoId);
            renderizarVeiculo(veiculoId);
            document.getElementById('veiculo-display-area')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

// ==================================================
//      BUSCA DADOS EXTERNOS (API SIMULADA - AGORA NO BACKEND!)
// ==================================================
async function buscarDetalhesVeiculoAPI(identificadorVeiculo) {
    console.log(`Buscando detalhes para ID: ${identificadorVeiculo} no backend...`);
    try {
        const response = await fetch(`${backendUrl}/api/detalhes-extras/${identificadorVeiculo}`);
        if (response.status === 404) {
             console.log(`Nenhum detalhe (backend) encontrado para ${identificadorVeiculo}. Será criado um novo no primeiro save.`);
             return { veiculoId: identificadorVeiculo }; // Retorna objeto base para permitir a criação.
        }
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || `Erro HTTP: ${response.status}`);
        }
        const detalhes = await response.json();
        console.log(`Detalhes (backend) encontrados para ${identificadorVeiculo}:`, detalhes);
        return detalhes;
    } catch (error) {
        console.error(`Erro ao buscar dados da API de detalhes:`, error);
        throw error; // Repassa o erro para ser tratado por quem chamou
    }
}


// --- NOVAS FUNÇÕES PARA EDIÇÃO DE DETALHES ---
function toInputDateString(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date - tzoffset)).toISOString().slice(0, -1);
    return localISOTime.split('T')[0];
}

function exibirDetalhesExtras(detalhes, areaDetalhes, veiculoId) {
    let html = '<p><i class="fa-regular fa-circle-xmark"></i> Nenhum detalhe extra para exibir. Clique em editar para adicionar.</p>';
    if (detalhes && Object.keys(detalhes).length > 1 && detalhes.veiculoId) {
        html = '<ul>';
        const valorFIPE = `R$ ${(detalhes.valorFIPE || 0).toFixed(2).replace('.', ',')}`;
        const recallPendente = detalhes.recallPendente ? '<strong style="color:red;">Sim</strong>' : 'Não';
        const dicaManutencao = detalhes.dicaManutencao || '-';
        let proxRevisao = '-';
        if (detalhes.proximaRevisaoRecomendada) {
            const dataRec = new Date(detalhes.proximaRevisaoRecomendada);
            if (!isNaN(dataRec.getTime())) {
                proxRevisao = dataRec.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
            }
        }
        
        html += `<li><strong>Valor FIPE:</strong> ${valorFIPE}</li>`;
        html += `<li><strong>Recall Pendente:</strong> ${recallPendente}</li>`;
        if (detalhes.recallPendente && detalhes.motivoRecall) {
            html += `<li style="padding-left: 15px; color: #d35400;"><strong>Motivo:</strong> ${detalhes.motivoRecall}</li>`;
        }
        html += `<li><strong>Dica Manutencao:</strong> ${dicaManutencao}</li>`;
        html += `<li><strong>Proxima Revisao Recomendada:</strong> ${proxRevisao}</li>`;
        html += '</ul>';
    }
    areaDetalhes.innerHTML = html;

    const btnEditar = areaDetalhes.closest('.detalhes-extras-card').querySelector('.btn-editar-detalhes');
    if(btnEditar) {
        btnEditar.style.display = 'inline-block';
        btnEditar.onclick = () => ativarModoEdicaoDetalhes(detalhes || { veiculoId }, areaDetalhes, veiculoId);
    }
}

function ativarModoEdicaoDetalhes(detalhes, areaDetalhes, veiculoId) {
    const proxRevisaoStr = detalhes.proximaRevisaoRecomendada ? toInputDateString(new Date(detalhes.proximaRevisaoRecomendada)) : '';
    const recallChecked = detalhes.recallPendente ? 'checked' : '';

    const formHtml = `
        <form class="form-detalhes-extras" style="text-align: left;">
            <label>Valor FIPE (R$):</label>
            <input type="number" name="valorFIPE" step="0.01" value="${detalhes.valorFIPE || ''}" placeholder="35000.50">
            <label>Dica de Manutenção:</label>
            <textarea name="dicaManutencao" placeholder="Dica fofa de manutenção">${detalhes.dicaManutencao || ''}</textarea>
            <label>Próxima Revisão Recomendada:</label>
            <input type="date" name="proximaRevisaoRecomendada" value="${proxRevisaoStr}">
            <div style="margin: 15px 0; display:flex; align-items:center;">
                <input type="checkbox" id="recallPendente-${veiculoId}" name="recallPendente" ${recallChecked} style="width: auto; margin-bottom: 0;">
                <label for="recallPendente-${veiculoId}" style="display:inline; margin-left: 8px; margin-bottom: 0; font-weight: normal;">Possui Recall Pendente?</label>
            </div>
            <label>Motivo do Recall (se houver):</label>
            <input type="text" name="motivoRecall" value="${detalhes.motivoRecall || ''}" placeholder="Motivo do recall">
            <div class="botoes-edicao" style="margin-top:15px;">
                <button type="submit" class="salvar-detalhes-btn modern-button"><i class="fa-solid fa-save"></i> Salvar</button>
                <button type="button" class="cancelar-detalhes-btn modern-button" style="background-color: var(--cor-texto-secundario-hk);"><i class="fa-solid fa-times"></i> Cancelar</button>
            </div>
        </form>
    `;
    areaDetalhes.innerHTML = formHtml;
    
    const btnEditar = areaDetalhes.closest('.detalhes-extras-card').querySelector('.btn-editar-detalhes');
    if(btnEditar) btnEditar.style.display = 'none';

    areaDetalhes.querySelector('.form-detalhes-extras').addEventListener('submit', (e) => {
        e.preventDefault();
        handleSalvarDetalhesExtras(e.target, veiculoId, areaDetalhes);
    });

    areaDetalhes.querySelector('.cancelar-detalhes-btn').addEventListener('click', () => {
        exibirDetalhesExtras(detalhes, areaDetalhes, veiculoId);
    });
}

async function handleSalvarDetalhesExtras(form, veiculoId, areaDetalhes) {
    const btnSalvar = form.querySelector('.salvar-detalhes-btn');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    const dados = {
        valorFIPE: parseFloat(form.elements.valorFIPE.value) || null,
        recallPendente: form.elements.recallPendente.checked,
        motivoRecall: form.elements.motivoRecall.value.trim(),
        dicaManutencao: form.elements.dicaManutencao.value.trim(),
        proximaRevisaoRecomendada: form.elements.proximaRevisaoRecomendada.value || null
    };

    try {
        const response = await fetch(`${backendUrl}/api/detalhes-extras/${veiculoId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Falha ao salvar os dados.');
        }

        const detalhesAtualizados = await response.json();
        alert('Detalhes salvos com sucesso!');
        exibirDetalhesExtras(detalhesAtualizados, areaDetalhes, veiculoId);

    } catch (error) {
        console.error("Erro ao salvar detalhes extras:", error);
        alert(`Erro: ${error.message}`);
        btnSalvar.disabled = false;
        btnSalvar.innerHTML = '<i class="fa-solid fa-save"></i> Salvar';
    }
}


// ==================================================
//      BUSCA DADOS EXTERNOS (AGORA VIA NOSSO BACKEND)
// ==================================================
async function buscarPrevisaoDetalhada(cidade) {
    if (!cidade) {
        console.error("[Frontend] Cidade é obrigatória para buscar previsão detalhada.");
        throw new Error("Por favor, informe a cidade."); 
    }

    const cidadeCodificada = encodeURIComponent(cidade);
    const urlAPI = `${backendUrl}/api/previsao/${cidadeCodificada}`;
    
    console.log(`[Frontend] Buscando previsão detalhada para: ${cidade} em ${urlAPI}`);

    try {
        const response = await fetch(urlAPI);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({})); 
            const mensagemErro = errorData.error || `Erro ${response.statusText} (${response.status}) ao buscar previsão no servidor.`;
            console.error(`[Frontend] Erro do backend (${response.status}): ${mensagemErro}`);
            throw new Error(mensagemErro);
        }
        const data = await response.json(); 
        console.log("[Frontend] Dados da previsão detalhada recebidos do backend:", data);
        return data; 
    } catch (error) { 
        console.error("[Frontend] Erro na requisição fetch ou processamento da previsão detalhada:", error.message);
        throw error; 
    }
}

function processarDadosForecast(data) {
    if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
        console.warn("[Frontend] Dados de forecast inválidos ou vazios para processamento recebidos do backend.");
        return null;
    }

    const previsaoPorDia = {};

    data.list.forEach(item => {
        const dia = item.dt_txt.split(' ')[0]; 

        if (!previsaoPorDia[dia]) {
            previsaoPorDia[dia] = {
                temps: [],
                weatherEntries: [], 
                dt_unix_list: []  
            };
        }
        previsaoPorDia[dia].temps.push(item.main.temp);
        previsaoPorDia[dia].weatherEntries.push({
            icon: item.weather[0].icon,
            description: item.weather[0].description,
            dt_txt: item.dt_txt 
        });
        previsaoPorDia[dia].dt_unix_list.push(item.dt);
    });

    const previsaoDiariaResumida = [];
    for (const diaStr in previsaoPorDia) {
        const dadosDoDia = previsaoPorDia[diaStr];
        const temp_min = Math.min(...dadosDoDia.temps);
        const temp_max = Math.max(...dadosDoDia.temps);
        let iconeRep = dadosDoDia.weatherEntries[0].icon;
        let descricaoRep = dadosDoDia.weatherEntries[0].description;
        const entradaMeioDia = dadosDoDia.weatherEntries.find(entry => entry.dt_txt.includes("12:00:00"));
        if (entradaMeioDia) {
            iconeRep = entradaMeioDia.icon;
            descricaoRep = entradaMeioDia.description;
        } else {
            const entradaMaisProximaMeioDia = dadosDoDia.weatherEntries.reduce((prev, curr) => {
                const horaPrev = parseInt(prev.dt_txt.split(' ')[1].split(':')[0]);
                const horaCurr = parseInt(curr.dt_txt.split(' ')[1].split(':')[0]);
                return (Math.abs(horaCurr - 12) < Math.abs(horaPrev - 12) ? curr : prev);
            });
            iconeRep = entradaMaisProximaMeioDia.icon;
            descricaoRep = entradaMaisProximaMeioDia.description;
        }
        previsaoDiariaResumida.push({
            data: diaStr,
            temp_min: parseFloat(temp_min.toFixed(1)),
            temp_max: parseFloat(temp_max.toFixed(1)),
            descricao: descricaoRep.charAt(0).toUpperCase() + descricaoRep.slice(1),
            icone: iconeRep
        });
    }
    previsaoDiariaResumida.sort((a,b) => new Date(a.data) - new Date(b.data));
    return previsaoDiariaResumida;
}

function aplicarFiltroEExibirPrevisao(numeroDeDias, areaResultado) {
    if (!previsaoProcessadaCompletaCache || !areaResultado) {
        console.warn("[Frontend] Cache de previsão ou área de resultado não disponíveis para aplicar filtro.");
        if (areaResultado) areaResultado.innerHTML = "<p>Dados de previsão não carregados para filtrar.</p>";
        const divControlesPrevisao = document.getElementById('controles-previsao');
        if (divControlesPrevisao) divControlesPrevisao.style.display = 'none';
        return;
    }
    const diasParaExibirReq = parseInt(numeroDeDias);
    let previsaoFiltrada;
    let numDiasStringParaComparacao = numeroDeDias.toString();
    if (isNaN(diasParaExibirReq) || diasParaExibirReq <= 0) {
        previsaoFiltrada = previsaoProcessadaCompletaCache;
        numDiasStringParaComparacao = previsaoProcessadaCompletaCache.length.toString(); 
    } else if (diasParaExibirReq > previsaoProcessadaCompletaCache.length) {
        previsaoFiltrada = previsaoProcessadaCompletaCache;
        numDiasStringParaComparacao = previsaoProcessadaCompletaCache.length.toString();
    } else {
        previsaoFiltrada = previsaoProcessadaCompletaCache.slice(0, diasParaExibirReq);
    }
    exibirPrevisaoDetalhada(previsaoFiltrada, nomeCidadeCache, areaResultado);
    document.querySelectorAll('#filtros-previsao-dias .filtro-dia-btn').forEach(btn => {
        btn.classList.toggle('filtro-dia-btn-ativo', btn.dataset.dias === numDiasStringParaComparacao);
    });
}

function exibirPrevisaoDetalhada(previsaoDiariaProcessada, nomeCidade, areaResultado) {
    if (!areaResultado) {
        console.error("[Frontend] Área de resultado para previsão detalhada não fornecida.");
        return;
    }
    areaResultado.innerHTML = ''; 
    if (!previsaoDiariaProcessada || previsaoDiariaProcessada.length === 0) {
        areaResultado.innerHTML = `<p><i class="fa-regular fa-circle-xmark"></i> Não há dados de previsão para exibir para "${nomeCidade}".</p>`;
        return;
    }
    const titulo = document.createElement('h4');
    titulo.innerHTML = `<i class="fa-solid fa-calendar-days"></i> Previsão para ${nomeCidade}`;
    areaResultado.appendChild(titulo);
    const containerDias = document.createElement('div');
    containerDias.className = 'forecast-container'; 
    previsaoDiariaProcessada.forEach(diaInfo => {
        const diaCard = document.createElement('div');
        diaCard.className = 'day-weather-card'; 
        const dataObj = new Date(diaInfo.data + 'T00:00:00');
        const dataFormatada = dataObj.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
        const iconeUrl = `https://openweathermap.org/img/wn/${diaInfo.icone}@2x.png`;
        diaCard.innerHTML = `
            <p class="forecast-date"><strong>${dataFormatada}</strong></p>
            <img src="${iconeUrl}" alt="${diaInfo.descricao}" class="weather-icon-daily" title="${diaInfo.descricao}">
            <p class="forecast-desc">${diaInfo.descricao}</p>
            <p class="forecast-temp">
                <i class="fa-solid fa-temperature-arrow-down"></i> ${diaInfo.temp_min}°C / 
                <i class="fa-solid fa-temperature-arrow-up"></i> ${diaInfo.temp_max}°C
            </p>
        `;
        containerDias.appendChild(diaCard);
    });
    areaResultado.appendChild(containerDias);
}

// ==================================================
//      FUNÇÕES DA API DE DICAS
// ==================================================
async function buscarDicasGerais() {
    try {
        const response = await fetch(`${backendUrl}/api/dicas-manutencao`);
        if (!response.ok) throw new Error(`Erro ${response.status} ao buscar dicas gerais.`);
        return await response.json();
    } catch (error) {
        console.error("Erro em buscarDicasGerais:", error);
        return null;
    }
}

async function buscarDicasPorTipo(tipoVeiculo) {
    if (!tipoVeiculo) return null;
    try {
        const response = await fetch(`${backendUrl}/api/dicas-manutencao/${tipoVeiculo}`);
        if (!response.ok) {
            if (response.status === 404) {
                const erroData = await response.json();
                return [{ id: 'not-found', dica: erroData.error || `Nenhuma dica encontrada para ${tipoVeiculo}.` }];
            }
            throw new Error(`Erro ${response.status} ao buscar dicas para ${tipoVeiculo}.`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Erro em buscarDicasPorTipo para "${tipoVeiculo}":`, error);
        return null;
    }
}

function exibirDicas(dicas, areaResultado) {
    if (!areaResultado) return;
    if (!dicas) {
        areaResultado.innerHTML = `<p style="color: red;"><i class="fa-solid fa-bomb"></i> Ops! Ocorreu um erro ao buscar as dicas no servidor.</p>`;
        return;
    }
    if (dicas.length === 0) {
        areaResultado.innerHTML = `<p><i class="fa-regular fa-face-surprise"></i> Nenhuma dica encontrada.</p>`;
        return;
    }
    if (dicas.length === 1 && dicas[0].id === 'not-found') {
        areaResultado.innerHTML = `<p style="color: orange;"><i class="fa-solid fa-magnifying-glass"></i> ${dicas[0].dica}</p>`;
        return;
    }
    const listaHtml = dicas.map(d => `<li><i class="fa-solid fa-wand-magic-sparkles" style="color: #FF69B4;"></i> ${d.dica}</li>`).join('');
    areaResultado.innerHTML = `<ul>${listaHtml}</ul>`;
}

// =================================================================
//      FUNÇÕES DA API - Veículos Destaque e Serviços
// =================================================================
async function buscarVeiculosDestaque() {
    try {
        const response = await fetch(`${backendUrl}/api/garagem/veiculos-destaque`);
        if (!response.ok) throw new Error(`Erro ${response.status} ao buscar veículos destaque.`);
        return await response.json();
    } catch (error) {
        console.error("Erro em buscarVeiculosDestaque:", error);
        return null;
    }
}

function exibirVeiculosDestaque(veiculos, container) {
    if (!container) return;
    if (!veiculos) {
        container.innerHTML = `<p style="color: red;">Ops! Erro ao carregar os veículos destaque.</p>`;
        return;
    }
    if (veiculos.length === 0) {
        container.innerHTML = `<p>Nenhum veículo em destaque no momento.</p>`;
        return;
    }
    container.innerHTML = veiculos.map(v => `
        <div class="veiculo-card">
            <img src="${v.imagemUrl || 'default_car.png'}" alt="Imagem de ${v.modelo}" class="veiculo-card-img">
            <h3>${v.modelo} (${v.ano})</h3>
            <p>${v.destaque}</p>
        </div>
    `).join('');
}

async function buscarServicosOferecidos() {
    try {
        const response = await fetch(`${backendUrl}/api/garagem/servicos-oferecidos`);
        if (!response.ok) throw new Error(`Erro ${response.status} ao buscar serviços.`);
        return await response.json();
    } catch (error) {
        console.error("Erro em buscarServicosOferecidos:", error);
        return null;
    }
}

function exibirServicosOferecidos(servicos, listaUl) {
    if (!listaUl) return;
    if (!servicos) {
        listaUl.innerHTML = `<li class="servico-item" style="border-left-color: red;">Ops! Erro ao carregar os serviços.</li>`;
        return;
    }
    if (servicos.length === 0) {
        listaUl.innerHTML = `<li class="servico-item">Nenhum serviço disponível no momento.</li>`;
        return;
    }
    listaUl.innerHTML = servicos.map(s => `
        <li class="servico-item">
            <strong>${s.nome}</strong>
            <em>${s.descricao}</em>
            <small>Preço Estimado: ${s.precoEstimado}</small>
        </li>
    `).join('');
}

async function carregarConteudoEstaticoDaAPI() {
    console.log("Carregando conteúdo estático das APIs (Destaques e Serviços)...");
    const containerDestaques = document.getElementById('cards-veiculos-destaque');
    const listaServicos = document.getElementById('lista-servicos-oferecidos');
    const [veiculos, servicos] = await Promise.all([
        buscarVeiculosDestaque(),
        buscarServicosOferecidos()
    ]);
    if (containerDestaques) exibirVeiculosDestaque(veiculos, containerDestaques);
    if (listaServicos) exibirServicosOferecidos(servicos, listaServicos);
    console.log("Conteúdo estático da API carregado.");
}

// ==================================================
//                   INICIALIZAÇÃO DA APLICAÇÃO
// ==================================================
function inicializarAplicacao() {
    console.log(`DOM Carregado. Iniciando Garagem Fofinha com Backend...`);
    try {
        setupEventListeners();
        carregarGaragem();
        carregarConteudoEstaticoDaAPI(); 
        console.log("Aplicação inicializada.");
    } catch (e) {
        console.error("ERRO CRÍTICO NA INICIALIZAÇÃO:", e);
        document.body.innerHTML = `<div style='color:red; border: 2px solid red; background: #ffebee; padding: 20px; text-align: center;'>
            <h1><i class="fa-solid fa-skull-crossbones"></i> Erro Grave na Inicialização</h1>
            <p>A aplicação não pôde ser iniciada: ${e.message}</p>
            <p>Verifique o console e se o servidor backend está rodando!</p>
        </div>`;
    }
}

function setupEventListeners() {
    console.log("Configurando Listeners Iniciais...");
    document.getElementById('tab-garagem')?.addEventListener('click', () => handleTrocarAba('tab-garagem'));
    document.getElementById('tab-adicionar')?.addEventListener('click', () => handleTrocarAba('tab-adicionar'));
    document.getElementById('form-add-veiculo')?.addEventListener('submit', handleAdicionarVeiculo);

    const tipoSelect = document.getElementById('add-tipo');
    const cargaContainer = document.getElementById('add-capacidade-carga-container');
    if (tipoSelect && cargaContainer) {
        const toggleCargaVisibility = () => {
             cargaContainer.style.display = tipoSelect.value === 'Caminhao' ? 'block' : 'none';
             if (tipoSelect.value !== 'Caminhao') {
                const capInput = cargaContainer.querySelector('#add-capacidade-carga');
                if(capInput) capInput.value = '';
             }
         };
        tipoSelect.addEventListener('change', toggleCargaVisibility);
        toggleCargaVisibility();
    }

    const addImagemInput = document.getElementById('add-imagem-input');
    const addImagemPreview = document.getElementById('add-imagem-preview');
    if (addImagemInput && addImagemPreview) {
        addImagemInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file && file.type.startsWith("image/")) {
                const reader = new FileReader();
                reader.onload = (e) => { addImagemPreview.src = e.target.result; addImagemPreview.style.display = 'block'; }
                reader.onerror = () => { addImagemPreview.src = '#'; addImagemPreview.style.display = 'none';}
                reader.readAsDataURL(file);
            } else { addImagemPreview.src = '#'; addImagemPreview.style.display = 'none'; }
        });
    }

    const btnBuscarPrevisao = document.getElementById('btn-buscar-previsao');
    const inputDestino = document.getElementById('viagem-destino');
    const areaResultadoPrevisao = document.getElementById('previsao-resultado-area');
    const divControlesPrevisao = document.getElementById('controles-previsao'); 

    if (btnBuscarPrevisao && inputDestino && areaResultadoPrevisao && divControlesPrevisao) {
        btnBuscarPrevisao.addEventListener('click', async () => {
            const cidade = inputDestino.value.trim();
            areaResultadoPrevisao.innerHTML = `<p><i class="fa-solid fa-spinner fa-spin"></i> Buscando previsão para ${cidade || "destino"}...</p>`;
            btnBuscarPrevisao.disabled = true;
            divControlesPrevisao.style.display = 'none'; 
            previsaoProcessadaCompletaCache = null; 
            nomeCidadeCache = "";
            if (!cidade) {
                areaResultadoPrevisao.innerHTML = `<p style="color: orange;"><i class="fa-solid fa-circle-exclamation"></i> Por favor, informe a Cidade de Destino.</p>`;
                btnBuscarPrevisao.disabled = false;
                return;
            }
            try {
                const dadosApi = await buscarPrevisaoDetalhada(cidade); 
                const cidadeRetornada = dadosApi.city?.name || cidade;
                nomeCidadeCache = cidadeRetornada;
                const previsaoProcessada = processarDadosForecast(dadosApi);
                if (previsaoProcessada && previsaoProcessada.length > 0) {
                    previsaoProcessadaCompletaCache = previsaoProcessada; 
                    const diasDefault = Math.min(5, previsaoProcessadaCompletaCache.length).toString();
                    aplicarFiltroEExibirPrevisao(diasDefault, areaResultadoPrevisao);
                    divControlesPrevisao.style.display = 'block'; 
                } else {
                    areaResultadoPrevisao.innerHTML = `<p><i class="fa-regular fa-circle-xmark"></i> Não foi possível processar os dados da previsão para "${cidadeRetornada}".</p>`;
                }
            } catch (error) { 
                console.error("[Frontend] Erro no fluxo de busca de previsão:", error);
                areaResultadoPrevisao.innerHTML = `<p style="color: red;"><i class="fa-solid fa-bomb"></i> Falha: ${error.message}</p>`;
                divControlesPrevisao.style.display = 'none';
                previsaoProcessadaCompletaCache = null;
                nomeCidadeCache = "";
            } finally {
                btnBuscarPrevisao.disabled = false;
            }
        });

        const divFiltrosDias = document.getElementById('filtros-previsao-dias');
        if (divFiltrosDias) {
            divFiltrosDias.addEventListener('click', (event) => {
                const targetButton = event.target.closest('.filtro-dia-btn'); 
                if (targetButton && targetButton.dataset.dias) {
                    const numDias = targetButton.dataset.dias;
                    aplicarFiltroEExibirPrevisao(numDias, areaResultadoPrevisao);
                }
            });
        }
    }
    
    const btnDicasGerais = document.getElementById('btn-buscar-dicas-gerais');
    const btnDicasTipo = document.getElementById('btn-buscar-dicas-tipo');
    const selectTipoDica = document.getElementById('select-tipo-dica');
    const dicasResultadoArea = document.getElementById('dicas-resultado-area');

    if (btnDicasGerais && dicasResultadoArea) {
        btnDicasGerais.addEventListener('click', async () => {
            dicasResultadoArea.innerHTML = `<p><i class="fa-solid fa-spinner fa-spin"></i> Buscando dicas gerais...</p>`;
            const dicas = await buscarDicasGerais();
            exibirDicas(dicas, dicasResultadoArea);
        });
    }

    if (btnDicasTipo && selectTipoDica && dicasResultadoArea) {
        btnDicasTipo.addEventListener('click', async () => {
            const tipoSelecionado = selectTipoDica.value;
            if (!tipoSelecionado) {
                alert('Por favor, escolha um tipo de veículo fofinho primeiro!');
                return;
            }
            dicasResultadoArea.innerHTML = `<p><i class="fa-solid fa-spinner fa-spin"></i> Buscando dicas para ${tipoSelecionado}...</p>`;
            const dicas = await buscarDicasPorTipo(tipoSelecionado);
            exibirDicas(dicas, dicasResultadoArea);
        });
    }
    console.log("Listeners Iniciais configurados.");
}

document.addEventListener('DOMContentLoaded', inicializarAplicacao);

