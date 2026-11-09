# Oficina Mecânica — OS Service

[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=fiap-soat-oficina-tech-challenge_tech-challenge-fiap&metric=alert_status)](https://sonarcloud.io/summary/overall?id=fiap-soat-oficina-tech-challenge_tech-challenge-fiap&branch=main)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=fiap-soat-oficina-tech-challenge_tech-challenge-fiap&metric=coverage)](https://sonarcloud.io/summary/overall?id=fiap-soat-oficina-tech-challenge_tech-challenge-fiap&branch=main)

Sistema de gestão de uma oficina mecânica, desenvolvido para o Tech Challenge da pós-graduação FIAP SOAT. Na **Fase 4**, a aplicação foi dividida em **três microsserviços independentes**, coordenados por uma **Saga orquestrada** sobre filas **Amazon SQS** e implantados no **Amazon EKS**.

Este repositório tem dois papéis:

- é o **OS Service**: abertura, status e histórico das ordens de serviço, clientes, veículos, catálogo de serviços e estoque, e o **orquestrador da Saga**;
- é a **porta de entrada da documentação da solução**: a primeira parte deste README apresenta a arquitetura completa, a divisão dos serviços, a estratégia da Saga, a qualidade e o deploy. Os detalhes de cada peça ficam no README do repositório dela.

## Índice

- [A solução na Fase 4](#a-solução-na-fase-4)
  - [Repositórios](#repositórios)
  - [Diagrama geral](#diagrama-geral)
  - [Por que esta divisão](#por-que-esta-divisão)
  - [Tecnologias](#tecnologias)
  - [Saga orquestrada](#saga-orquestrada)
  - [Ciclo da OS](#ciclo-da-os)
  - [Caminho feliz](#caminho-feliz)
  - [Transições e compensações](#transições-e-compensações)
  - [Garantias](#garantias)
  - [Rastreamento distribuído](#rastreamento-distribuído)
  - [Qualidade: testes, cobertura e SonarQube](#qualidade-testes-cobertura-e-sonarqube)
  - [CI/CD e ambiente na AWS](#cicd-e-ambiente-na-aws)
  - [Vídeo de demonstração](#vídeo-de-demonstração)
- [OS Service](#os-service)
  - [Objetivos do sistema](#objetivos-do-sistema)
  - [Rota interna da Lambda de autenticação](#rota-interna-da-lambda-de-autenticação)
  - [Teste de integração dos três serviços](#teste-de-integração-dos-três-serviços)
  - [BDD do fluxo completo](#bdd-do-fluxo-completo)
- [Clean Architecture (interno da API)](#clean-architecture-interno-da-api)
- [Arquitetura](#arquitetura)
- [Justificativa do banco de dados](#justificativa-do-banco-de-dados)
- [Modelo de dados (Diagrama ER)](#modelo-de-dados-diagrama-er)
- [Stack](#stack)
- [Pré-requisitos](#pré-requisitos)
- [Execução local (Docker Compose)](#execução-local-docker-compose)
- [Execução local (desenvolvimento)](#execução-local-desenvolvimento)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Notificações por e-mail (Lambda)](#notificações-por-e-mail-lambda)
- [Autenticação](#autenticação)
- [Documentação da API](#documentação-da-api)
- [Documentação de arquitetura](#documentação-de-arquitetura)
- [Endpoints da API](#endpoints-da-api)
- [Fluxo da Ordem de Serviço](#fluxo-da-ordem-de-serviço)
- [Observabilidade](#observabilidade)
- [Testes](#testes)
- [Scripts disponíveis](#scripts-disponíveis)
- [Infraestrutura e deploy na AWS (EKS)](#infraestrutura-e-deploy-na-aws-eks)

## A solução na Fase 4

O enunciado pede no mínimo três microsserviços, cada um com **repositório, infraestrutura e banco de dados próprios**, comunicação por APIs REST e mensageria, uma Saga com compensação em qualquer etapa e, em cada serviço, testes unitários, cobertura mínima de 80%, verificação de qualidade no CI e deploy automatizado no Kubernetes. A solução atende a cada um desses pontos assim:

| Requisito | Como foi atendido |
|---|---|
| Três microsserviços independentes | OS Service, Billing Service e Execution Service, cada um com repositório, pipeline, imagem, namespace no EKS e `terraform/` próprios |
| Banco por serviço, com SQL e NoSQL | PostgreSQL no OS e no Billing (um RDS para cada um), DynamoDB no Execution. Nenhum serviço acessa o banco de outro |
| REST e mensageria | REST para as pessoas e sistemas externos; Amazon SQS (com DLQ) para toda a comunicação entre os serviços |
| Saga com compensação | Orquestrada pelo OS Service; toda falha tem uma compensação ([Transições e compensações](#transições-e-compensações)) |
| Pagamento pelo Mercado Pago | QR Code dinâmico (Orders API), no Billing, com estorno como compensação |
| Testes, BDD e cobertura | Unitários nos três serviços, cobertura acima de 80% em todos, e o fluxo completo da OS em BDD com os três serviços juntos |
| Qualidade no CI | SonarQube Cloud nos três pipelines, com o quality gate como check obrigatório |
| Deploy automatizado e `main` protegida | GitHub Actions: CI → imagem no ECR → deploy no EKS → smoke test. `main` com PR, aprovação e checks obrigatórios |
| Observabilidade da Fase 3 | New Relic em todos os componentes, com o `correlationId` da OS nos logs dos três serviços |

### Repositórios

A solução tem cinco repositórios, todos na organização [`fiap-soat-oficina-tech-challenge`](https://github.com/fiap-soat-oficina-tech-challenge):

| Repositório | Papel | Banco e infraestrutura própria | Pipeline |
|---|---|---|---|
| [**`tech-challenge-fiap`**](https://github.com/fiap-soat-oficina-tech-challenge/tech-challenge-fiap) (este) | **OS Service** e orquestrador da Saga | PostgreSQL (RDS `oficina-os-db`), fila de respostas da Saga | CI (lint, unitários, e2e, SonarQube, BDD com os três serviços) → ECR → EKS |
| [`oficina-billing-service`](https://github.com/fiap-soat-oficina-tech-challenge/oficina-billing-service) | **Billing Service**: orçamento, aprovação, pagamento no Mercado Pago e estorno | PostgreSQL (RDS `oficina-billing-db`), fila de comandos, ECR | CI (lint, unitários, SonarQube) → ECR → EKS |
| [`oficina-execution-service`](https://github.com/fiap-soat-oficina-tech-challenge/oficina-execution-service) | **Execution Service**: fila de diagnóstico e reparo do mecânico | DynamoDB `oficina-execution-tarefas`, fila de comandos, ECR | CI (lint, unitários, SonarQube) → ECR → EKS |
| [`tc3-infra-k8s`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-infra-k8s) | **Plataforma**: VPC, cluster EKS, ALB Controller, ECR do OS, OIDC do GitHub, observabilidade New Relic; workflow que sobe e derruba o ambiente inteiro | — | Terraform (plan no PR, apply no push) |
| [`tc3-auth-lambda`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-auth-lambda) | **Entrada**: API Gateway, Lambda de autenticação por CPF e Lambda de e-mail | — | Testes, empacotamento e Terraform |

Os três serviços rodam no mesmo cluster EKS, cada um no seu namespace (`oficina`, `oficina-billing` e `oficina-execution`), atrás do mesmo ALB e do mesmo API Gateway. O cluster compartilhado foi validado pelo professor no fórum: cada serviço continua com repositório, banco e infraestrutura sob sua responsabilidade, na pasta `terraform/` do próprio repositório. Os contratos entre os serviços (filas, envelope, mensagens, transições e rotas) estão em [`docs/contratos.md`](docs/contratos.md).

O repositório `tc3-infra-db` da Fase 3 foi arquivado: o banco do OS passou para a pasta [`terraform/`](terraform/README.md) deste repositório.

### Diagrama geral

```mermaid
graph TB
    Cliente["Cliente / Funcionário / Mecânico"]
    Externo["Sistema externo<br/>(aprovação de orçamento)"]
    MP["Mercado Pago<br/>(QR Code dinâmico)"]
    NR["New Relic<br/>(APM, logs, métricas, alertas)"]

    subgraph AWS["AWS"]
        GW["API Gateway<br/>/auth · /mail → Lambdas<br/>/#123;proxy+#125; → ALB"]
        LAuth["Lambda auth (CPF)"]
        LMail["Lambda e-mail"]
        ALB["ALB compartilhado<br/>/ → OS · /billing → Billing · /execution → Execution"]

        subgraph EKS["EKS (um namespace por serviço)"]
            OS["<b>OS Service</b><br/>orquestrador da Saga"]
            BI["<b>Billing Service</b>"]
            EX["<b>Execution Service</b>"]
        end

        subgraph SQS["Amazon SQS (cada fila com DLQ)"]
            QR[["oficina-os-saga-replies"]]
            QB[["oficina-billing-commands"]]
            QE[["oficina-execution-commands"]]
        end

        DBOS[("PostgreSQL<br/>OS")]
        DBBI[("PostgreSQL<br/>Billing")]
        DDB[("DynamoDB<br/>tarefas")]
    end

    Cliente --> GW
    Externo --> GW
    GW --> LAuth
    GW --> LMail
    GW --> ALB
    ALB --> OS
    ALB --> BI
    ALB --> EX
    LAuth -->|"POST /internal/clientes/busca"| GW

    OS -->|"comandos"| QB
    OS -->|"comandos"| QE
    QB --> BI
    QE --> EX
    BI -->|"respostas"| QR
    EX -->|"respostas"| QR
    QR --> OS

    OS --- DBOS
    BI --- DBBI
    EX --- DDB
    BI -->|"cobrança · consulta · cancelamento · estorno"| MP
    MP -->|"aviso de pagamento (webhook)"| GW
    OS -->|"e-mail"| GW
    BI -->|"e-mail"| GW
    EKS -.->|"telemetria"| NR
```

Nenhum serviço acessa o banco de outro. O que um precisa saber do outro chega numa mensagem, como cópia, ou por uma chamada REST.

As credenciais de banco são separadas: cada serviço recebe só a sua (a `DATABASE_URL` do próprio RDS, ou o nome da própria tabela no DynamoDB). Já as permissões da AWS, de filas e DynamoDB, ficam na role dos nós do EKS, compartilhada pelos três serviços. Então o isolamento entre eles vem do código e da configuração de cada um, e não do IAM. Uma role por serviço (IRSA ou EKS Pod Identity) fecharia esse ponto e fica como evolução.

### Por que esta divisão

A divisão segue a sugerida pelo enunciado e separa as áreas que mudam por motivos diferentes:

- **OS Service:** fica com o que o atendimento usa. Abertura, status e histórico da OS, e também clientes, veículos, catálogo de serviços e estoque, que são consultados e alterados junto com a OS (a baixa de estoque acontece ao lançar o item). Separar o estoque criaria mais uma Saga sem ganho para o desafio.
- **Billing Service:** concentra o dinheiro (orçamento, aprovação, pagamento e estorno) e a integração com o Mercado Pago. Uma falha do Mercado Pago não derruba a abertura nem a execução de OS.
- **Execution Service:** isola a fila do mecânico, que tem outro ritmo e outro formato de dado (tarefas autocontidas, lidas por status). É o lugar natural do banco NoSQL.

### Tecnologias

| Escolha | Por quê |
|---|---|
| **NestJS e TypeScript** nos três serviços | A mesma stack da Fase 3. O grupo reaproveita o padrão de módulos (Clean Architecture), os testes, a autenticação e a observabilidade, e a base comum é igual nos três |
| **Amazon SQS** | Gerenciado e já na conta, com DLQ e entrega "pelo menos uma vez", que os consumidores tratam com idempotência. Não exige manter um broker no cluster |
| **PostgreSQL (RDS)** no OS e no Billing | Onde há transação e dinheiro: estoque, OS, orçamento e pagamento precisam de ACID, chaves únicas e valores decimais exatos |
| **DynamoDB** no Execution | As tarefas são documentos autocontidos, lidos por chave e por status. A idempotência sai da própria chave, com escrita condicional, e não há servidor de banco para manter |
| **Mercado Pago, QR Code dinâmico** | O produto indicado no enunciado. A order é criada na aprovação do orçamento, e o estorno total é a compensação da falha no reparo |
| **EKS, ALB e API Gateway** | A plataforma da Fase 3, reaproveitada: um namespace por serviço e uma única entrada pública |
| **Terraform e GitHub Actions** | Infraestrutura como código em cada repositório e deploy automático, com autenticação na AWS por OIDC, sem chave guardada |
| **SonarQube Cloud** | Verificação de qualidade no CI, com cobertura e quality gate nos PRs |
| **New Relic** | A observabilidade da Fase 3, agora com um app por serviço e o `correlationId` da OS nos logs dos três |

### Saga orquestrada

A Saga é **orquestrada**: o OS Service é o orquestrador central. Ele publica um comando para o serviço da etapa (fila de comandos dele) e reage à resposta (fila `oficina-os-saga-replies`). Billing e Execution nunca falam entre si.

**Por que orquestrada, e não coreografada:**

- **O fluxo tem dono.** A OS já é a entidade que atravessa todas as etapas e guarda o status e o histórico. Com o orquestrador, a sequência e as compensações ficam num lugar só ([`ProcessarRespostaSagaUseCase`](src/modules/ordem-servico/application/use-case/processar-resposta-saga.use-case.ts)), em vez de espalhadas por reações em três serviços.
- **Compensações explícitas.** Cada falha tem uma linha na tabela de transições com a compensação correspondente. Na coreografia, descobrir quem compensa o quê exige ler os três serviços.
- **Menos acoplamento entre os participantes.** Billing e Execution só conhecem os próprios comandos e a fila de respostas. Não precisam saber da existência um do outro.
- **Rastreamento simples.** Toda mensagem nasce ou termina no OS, com o `correlationId` da OS.

O custo é o orquestrador concentrar a lógica do fluxo. Com três serviços e um fluxo linear, esse custo é pequeno.

### Ciclo da OS

```mermaid
stateDiagram-v2
    [*] --> RECEBIDA: abertura (publica IniciarDiagnostico)
    RECEBIDA --> EM_DIAGNOSTICO: DiagnosticoIniciado
    EM_DIAGNOSTICO --> AGUARDANDO_APROVACAO: OrcamentoEnviado
    AGUARDANDO_APROVACAO --> AGUARDANDO_PAGAMENTO: OrcamentoAprovado
    AGUARDANDO_PAGAMENTO --> EM_EXECUCAO: PagamentoConfirmado (publica IniciarReparo)
    EM_EXECUCAO --> FINALIZADA: ReparoConcluido
    FINALIZADA --> ENTREGUE: entrega (API)

    RECEBIDA --> CANCELADA: ExecucaoFalhou (diagnóstico)
    EM_DIAGNOSTICO --> CANCELADA: ExecucaoFalhou (diagnóstico) ou GeracaoOrcamentoFalhou
    AGUARDANDO_APROVACAO --> CANCELADA: OrcamentoRecusado ou cancelamento pelo funcionário
    AGUARDANDO_PAGAMENTO --> CANCELADA: cancelamento pelo funcionário
    EM_EXECUCAO --> CANCELADA: ExecucaoFalhou (reparo)
    ENTREGUE --> [*]
    CANCELADA --> [*]
```

Toda passagem para `CANCELADA` é uma compensação: devolve o estoque e grava o motivo. Um pagamento recusado **não** cancela a OS: o QR Code do Mercado Pago continua valendo, e o cliente paga de novo por ele.

### Caminho feliz

```mermaid
sequenceDiagram
    actor F as Funcionário
    actor M as Mecânico
    actor C as Cliente
    participant OS as OS Service
    participant EX as Execution
    participant BI as Billing
    participant MP as Mercado Pago

    F->>OS: POST /ordens-servico
    OS-)EX: IniciarDiagnostico
    M->>EX: iniciar diagnóstico
    EX-)OS: DiagnosticoIniciado → EM_DIAGNOSTICO
    M->>OS: lança serviços e itens (baixa de estoque)
    M->>EX: concluir diagnóstico
    EX-)OS: DiagnosticoConcluido (trava as linhas)
    OS-)BI: GerarOrcamento (cópia das linhas e preços)
    BI-)OS: OrcamentoEnviado → AGUARDANDO_APROVACAO
    C->>BI: POST /billing/orcamentos/{id}/aprovar
    BI->>MP: cria a cobrança (QR Code)
    BI-)OS: OrcamentoAprovado → AGUARDANDO_PAGAMENTO
    C->>MP: paga lendo o QR Code no app
    MP->>BI: aviso (webhook) · BI confirma em GET /v1/orders/{id}
    BI-)OS: PagamentoConfirmado → EM_EXECUCAO
    OS-)EX: IniciarReparo
    M->>EX: iniciar e concluir reparo
    EX-)OS: ReparoConcluido → FINALIZADA (e-mail ao cliente)
    F->>OS: entrega → ENTREGUE
```

### Transições e compensações

O que o orquestrador faz ao receber cada resposta (`docs/contratos.md`, seção 6):

| Status da OS | Evento | O OS faz | Novo status |
|---|---|---|---|
| — | Abertura (REST) | publica `IniciarDiagnostico` | `RECEBIDA` |
| `RECEBIDA` | `DiagnosticoIniciado` | — | `EM_DIAGNOSTICO` |
| `EM_DIAGNOSTICO` | `DiagnosticoConcluido` | trava as linhas e publica `GerarOrcamento` | `EM_DIAGNOSTICO` |
| `EM_DIAGNOSTICO` | `OrcamentoEnviado` | — | `AGUARDANDO_APROVACAO` |
| `EM_DIAGNOSTICO` | `GeracaoOrcamentoFalhou` | **compensa:** devolve o estoque | `CANCELADA` |
| `AGUARDANDO_APROVACAO` | `OrcamentoAprovado` | — | `AGUARDANDO_PAGAMENTO` |
| `AGUARDANDO_APROVACAO` | `OrcamentoRecusado` | **compensa:** devolve o estoque | `CANCELADA` |
| `AGUARDANDO_APROVACAO` ou `AGUARDANDO_PAGAMENTO` | Cancelamento pelo funcionário (REST) | **compensa:** publica `CancelarOrcamento` (o Billing cancela a cobrança e estorna, se houver pagamento) e devolve o estoque | `CANCELADA` |
| `AGUARDANDO_PAGAMENTO` | `PagamentoConfirmado` | publica `IniciarReparo` | `EM_EXECUCAO` |
| `EM_EXECUCAO` | `ReparoConcluido` | e-mail de finalização | `FINALIZADA` |
| `RECEBIDA` ou `EM_DIAGNOSTICO` | `ExecucaoFalhou` (diagnóstico) | **compensa:** devolve o estoque | `CANCELADA` |
| `EM_EXECUCAO` | `ExecucaoFalhou` (reparo) | **compensa:** publica `EstornarPagamento` e devolve o estoque | `CANCELADA` |
| `CANCELADA` | `PagamentoEstornado` | registra no histórico | `CANCELADA` |
| `FINALIZADA` | Entrega (REST) | e-mail de entrega | `ENTREGUE` |

Uma resposta em outro status (repetida ou atrasada) é descartada com um aviso no log. Se o cliente pagar enquanto a OS é cancelada, o `PagamentoConfirmado` é descartado aqui, e o Billing estorna ao processar o `CancelarOrcamento`. Nenhuma OS cancelada fica com dinheiro retido.

### Garantias

- **Idempotência pelo estado.** O SQS entrega cada mensagem pelo menos uma vez. Cada resposta só vale num status, e a transição grava com o status lido no filtro (`UPDATE ... WHERE status = <lido>`). Uma resposta repetida não muda nada, e uma corrida com outra ação devolve a mensagem para a fila. Não há tabela de mensagens processadas.
- **Gravar e publicar juntos.** O próximo comando é publicado **dentro** da transação do banco, antes do commit. Se a publicação falha, nada é gravado (a abertura da OS falha, ou a resposta volta para a fila). É a alternativa enxuta ao outbox transacional.
- **Linhas travadas.** Serviços e itens só podem ser lançados até o diagnóstico concluído, porque o orçamento é gerado com aquela cópia. Depois disso a edição responde 409, e a trava é conferida dentro da transação da edição.
- **Falha técnica vira nova tentativa.** Se o banco cai, a mensagem não é apagada: o SQS reenvia e, depois de 5 tentativas, a move para a DLQ `oficina-os-saga-replies-dlq`, que tem alerta no New Relic. Falha de negócio chega como resposta de falha e vira compensação.
- **Histórico com o ator real.** As transições da Saga usam o criador da OS como usuário (ADR-001) e dizem na observação quem agiu ("Billing: …", "Execution: …").

### Rastreamento distribuído

O `correlationId` nasce na abertura da OS: é o header `x-correlation-id` da requisição; sem ele, o id de requisição do API Gateway ou do ALB (`X-Amzn-Trace-Id`) ou, em último caso, um UUID novo. Ele fica gravado na OS e vai em toda mensagem. Os três serviços escrevem esse id nos logs JSON ao consumir as mensagens, então **filtrar por `correlationId` no New Relic mostra o fluxo de uma OS nos três serviços**, como validado no fórum da disciplina. Cada serviço também é um app próprio no APM do New Relic. Ver [Observabilidade](#observabilidade).

### Qualidade: testes, cobertura e SonarQube

| Serviço | Testes | Cobertura de linhas | Evidência |
|---|---|---|---|
| OS Service | 436 unitários, 66 e2e (PostgreSQL real), integração e BDD com os três serviços | **94,9%** (unitários + e2e) | [print](docs/cobertura.png) · [SonarQube](https://sonarcloud.io/summary/overall?id=fiap-soat-oficina-tech-challenge_tech-challenge-fiap&branch=main) |
| Billing Service | 230 unitários e teste de ponta a ponta | **97,1%** | [README](https://github.com/fiap-soat-oficina-tech-challenge/oficina-billing-service#testes-e-cobertura) · [SonarQube](https://sonarcloud.io/summary/overall?id=fiap-soat-oficina-tech-challenge_oficina-billing-service&branch=main) |
| Execution Service | 122 unitários e teste de ponta a ponta | **98,9%** | [README](https://github.com/fiap-soat-oficina-tech-challenge/oficina-execution-service#testes-e-cobertura) · [SonarQube](https://sonarcloud.io/summary/overall?id=fiap-soat-oficina-tech-challenge_oficina-execution-service&branch=main) |

O Jest de cada serviço falha abaixo de 80% de linhas e instruções. O detalhe do OS está em [Testes](#testes).

**BDD.** O fluxo completo de uma OS, da abertura à entrega, é testado em Gherkin com os três serviços de verdade, os dois PostgreSQL, o LocalStack e o simulador do Mercado Pago, em todo PR do OS ([BDD do fluxo completo](#bdd-do-fluxo-completo)).

**SonarQube Cloud.** O passo de análise roda dentro do job `Build & Test` de cada serviço e envia o código e o relatório de cobertura (lcov). Ele espera o resultado do quality gate e falha o job se o gate reprovar. Na `main` dos três repositórios, `Build & Test` e `SonarCloud Code Analysis` são checks obrigatórios, junto com uma aprovação de outro integrante e a branch atualizada.

O plano gratuito do SonarQube Cloud só disponibiliza o resultado da branch principal (`main`) e dos PRs. Por isso, a análise roda **em todo PR** e **no push da `main`**, e não roda no push da `develop`. Isso não deixa código sem verificação: todo código chega à `develop` e à `main` por um PR, e o mesmo commit acabou de ser analisado no PR que o levou até lá, com o quality gate travando o merge. O push da `main`, que é a branch entregue, roda o pipeline completo: build → testes → SonarQube → deploy.

### CI/CD e ambiente na AWS

Cada serviço tem o próprio pipeline no GitHub Actions, independente dos outros:

```mermaid
flowchart LR
    PR["PR"] --> CI
    PUSH["push na develop ou na main"] --> CI
    CI["CI<br/>lint · testes com cobertura ≥ 80%<br/>SonarQube (PR e main) · build"]
    CI -->|push| IMG["Imagem no ECR<br/>(tag = commit)"]
    IMG --> DEP["Deploy no EKS<br/>Secret do SSM · migrations · rollout"]
    DEP --> SMK["Smoke test"]
```

Nos PRs, o CI é o check obrigatório. No push, o CD roda o mesmo CI como primeiro estágio, então nada vai para o cluster sem passar pelos testes. A autenticação na AWS é por OIDC, sem chave de acesso guardada no GitHub.

O ambiente roda numa **conta AWS própria do grupo** (não no AWS Academy), em `us-east-1`, e não é mantido no ar o tempo todo, por custo. O workflow **Ambiente** do [`tc3-infra-k8s`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-infra-k8s#subir-e-derrubar-o-ambiente-inteiro) sobe e derruba tudo por tag, na ordem das dependências: plataforma → API Gateway e Lambdas → `terraform/` dos três serviços. Depois, o CD de cada serviço faz o deploy. Como os recursos são recriados a cada subida, os endereços (API Gateway e ALB) mudam; o atual fica no parâmetro `API_GATEWAY_URL` do SSM.

### Vídeo de demonstração

**Fase 4:** _link a incluir_ — fluxo completo de uma OS pelos três serviços, a Saga com as compensações, o deploy automatizado de um serviço com os testes e o rastreamento do fluxo no New Relic.

Vídeo da Fase 3, como referência: [https://youtu.be/P01Bz7Hop7w](https://youtu.be/P01Bz7Hop7w).

## OS Service

O OS Service é dono da ordem de serviço e dos cadastros que ela usa (clientes, veículos, catálogo de serviços e estoque), autentica os funcionários e orquestra a Saga. A API cobre a gestão desses cadastros e das ordens de serviço, com **autenticação dupla** (funcionário por e-mail e senha; cliente por **CPF, via Lambda**), acompanhamento público da OS e observabilidade (health, logs JSON com correlação, APM).

### Objetivos do sistema

- Substituir o controle manual por planilhas por um sistema integrado
- Permitir criação e acompanhamento de ordens de serviço com fluxo de status completo (RECEBIDA → EM_DIAGNOSTICO → AGUARDANDO_APROVACAO → AGUARDANDO_PAGAMENTO → EM_EXECUCAO → FINALIZADA → ENTREGUE, ou CANCELADA por compensação)
- Gerar orçamentos automaticamente com base nos serviços e peças incluídos na OS (Billing)
- Enviar orçamento ao cliente por e-mail para aprovação e cobrar pelo Mercado Pago (Billing)
- Organizar a fila de diagnóstico e reparo do mecânico (Execution)
- Permitir que o cliente acompanhe a OS pela consulta pública e pelas rotas autenticadas por CPF
- Controlar estoque de peças e insumos com alerta de estoque mínimo
- Monitorar tempo médio de execução dos serviços
- Prover infraestrutura reprodutível via Terraform e Kubernetes, com deploy automatizado por pipeline CI/CD

### Rota interna da Lambda de autenticação

`POST /internal/clientes/busca` (CPF no corpo, header `x-internal-token`) devolve `{ id, nome, status }`. É por ela que a Lambda de autenticação por CPF ([`tc3-auth-lambda`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-auth-lambda)) confere o cliente, sem ler o banco do OS. O token é gerado pelo [`terraform/ssm.tf`](terraform/ssm.tf) e guardado só no SSM.

### Teste de integração dos três serviços

[`test/integracao/`](test/integracao/) sobe OS, Billing e Execution juntos com Docker Compose. As dependências são os dois PostgreSQL, o LocalStack (SQS e DynamoDB) e o simulador do Mercado Pago (WireMock). Depois, percorre a Saga só pelas APIs públicas:

```bash
cd test/integracao
BILLING_DIR=<repo do Billing> EXECUTION_DIR=<repo do Execution> \
  docker compose -p oficina-integracao up -d --build
bash teste-saga.sh
docker compose -p oficina-integracao down -v
```

São 44 verificações em quatro cenários:

1. o caminho feliz até a entrega, com uma tentativa de pagamento recusada antes da aprovada;
2. a falha no reparo depois do pagamento, com o estorno;
3. o cancelamento pelo funcionário com a OS esperando o pagamento, com a cobrança cancelada no Mercado Pago;
4. o mesmo `correlationId` nos logs dos três serviços.

### BDD do fluxo completo

O PDF pede pelo menos um fluxo completo testado com BDD, e o professor orientou que o cenário principal suba os três serviços juntos. A funcionalidade [`test/bdd/features/ordem-servico-completa.feature`](test/bdd/features/ordem-servico-completa.feature) descreve em Gherkin, em português, uma OS que vai da abertura à entrega:

1. o funcionário abre a OS e o estoque é baixado;
2. o Execution põe o diagnóstico na fila e o mecânico o conclui;
3. o Billing gera o orçamento com o total da OS e o cliente aprova;
4. o cliente recebe o QR Code de pagamento, e o Mercado Pago avisa o pagamento aprovado;
5. o Execution põe o reparo na fila e o mecânico o conclui;
6. o funcionário registra a entrega.

O histórico da OS precisa mostrar as sete etapas na ordem.

Os passos ([`test/bdd/steps/`](test/bdd/steps/)) chamam só as APIs públicas dos serviços, como fariam o funcionário, o mecânico, o cliente e o Mercado Pago. Cada etapa assíncrona da Saga é esperada consultando de novo até o valor aparecer, por até 30 s, sem pausa fixa. O cenário cria dados únicos (CPF, placa e SKU), então roda de novo no mesmo ambiente sem conflito. Ferramenta: [Cucumber](https://github.com/cucumber/cucumber-js), com os passos em TypeScript.

```bash
cd test/integracao
BILLING_DIR=<repo do Billing> EXECUTION_DIR=<repo do Execution> \
  docker compose -p oficina-integracao up -d --build --wait
cd ../..
BDD_JWT_SECRET=segredo-de-integracao npm run test:bdd   # relatório em test/bdd/relatorio/cucumber.html
```

`BDD_JWT_SECRET` é o `JWT_SECRET` dos serviços no compose: o cenário assina com ele o token do cliente, que em produção vem da Lambda de autenticação por CPF.

No CI, o job **BDD (três serviços)** do `ci.yml` faz o mesmo em todo PR: baixa o Billing e o Execution na branch de destino do PR, constrói os três, roda o cenário e publica o relatório HTML como artefato da execução. É um check obrigatório da `main`. No push na `develop` e na `main`, o CD roda o mesmo `ci.yml` antes de publicar a imagem.

## Clean Architecture (interno da API)

Todos os módulos de negócio (`auth`, `cliente`, `mail`, `item-estoque`, `ordem-servico`, `servico`, `user`, `veiculo`) seguem o mesmo padrão de Clean Architecture em 4 camadas, garantindo separação de responsabilidades e inversão de dependências:

```
src/modules/<módulo>/
├── interface/          → Controllers (HTTP), validações de entrada (DTOs), guards
├── application/        → Use cases (1 arquivo = 1 responsabilidade), mappers de resposta
├── domain/             → Entities, Repository interfaces, Domain services puros
├── infra/              → Adaptadores específicos do módulo (ex.: BcryptPasswordHasher
│                         em auth/infra e user/infra, JwtTokenIssuer em auth/infra,
│                         NestMailerEmailSender em mail/infra)
└── <módulo>.module.ts  → Wire-up NestJS (providers, imports, exports)

src/infra/database/prisma/repositories/
                        → Prisma repositories centralizados, implementando as
                          Repository interfaces expostas por cada domínio
                          (usam o PrismaService de src/modules/prisma)
```

**Princípios aplicados:**

- **Inversão de dependência:** use cases dependem de `Repository` (interface no `domain`), nunca da implementação Prisma
- **Use case por classe:** cada use case é um `@Injectable` com um único método `execute()`
- **Domain services puros:** funções puras em `domain/services/` (ex.: `garantirCpfCnpjUnico`, `buscarClienteOuFalhar`) sem estado nem dependência de framework
- **Tokens de DI como string inline:** `@Inject('CLIENTE_REPOSITORY')` para desacoplar módulos
- **Snapshots imutáveis:** serviços e itens de estoque adicionados a uma OS ficam com nome e preço copiados no momento da inclusão, isolados de mudanças futuras no cadastro

## Arquitetura

Os diagramas desta seção mostram a plataforma na AWS e o interior do OS Service. A visão com os três serviços está no [Diagrama geral](#diagrama-geral).

### Diagrama de Componentes — visão de nuvem

Visão de nuvem do OS Service: o cliente entra pelo **API Gateway**, que roteia a **autenticação** (`/auth`) e as **notificações** (`/mail`) para **Lambdas** e as demais rotas para o **ALB → pods no EKS**. O OS usa o próprio **RDS PostgreSQL**, troca mensagens da Saga pelo **SQS**, lê os segredos do **SSM** (os mesmos `JWT_SECRET` e `MAIL_API_TOKEN` das Lambdas) e puxa a imagem do **ECR**. A Lambda de autenticação consulta o cliente pela rota interna do OS, e a de e-mail cuida do SMTP. O New Relic coleta métricas, logs e traces.

```mermaid
graph TB
    Cliente["Cliente / Funcionário<br/>browser · curl · Postman"]
    SMTP["SMTP<br/>Ethereal / SES<br/>(usado pela Lambda de e-mail)"]
    Obs["Observabilidade<br/>New Relic — métricas, APM,<br/>dashboards, alertas + logs JSON"]

    subgraph AWS["AWS · us-east-1"]
        GW["<b>API Gateway</b> (HTTP v2)<br/>POST /auth → Lambda auth<br/>POST /mail → Lambda e-mail<br/>ANY /#123;proxy+#125; → ALB (VPC Link)"]
        LambdaAuth["<b>Lambda</b> — auth por CPF<br/>valida CPF · checa status · emite JWT"]
        ECR["<b>ECR</b><br/>imagem do OS"]
        SSM["<b>SSM Parameter Store</b><br/>JWT_SECRET, DATABASE_URL, MAIL_API_TOKEN,<br/>INTERNAL_API_TOKEN (SecureString)"]
        SQS[["<b>SQS</b><br/>comandos e respostas da Saga"]]

        subgraph VPC["VPC — subnets privadas"]
            LambdaMail["<b>Lambda</b> — notificações<br/>envia e-mail via SMTP"]
            ALB["<b>ALB</b> internet-facing<br/>Ingress via ALB Controller"]

            subgraph EKS["<b>EKS</b> — namespace oficina"]
                Pods["Deployment oficina-api<br/>2–10 pods (HPA) em 2 AZs<br/>NestJS · /health · logs JSON"]
            end

            RDS[("<b>RDS PostgreSQL</b> oficina-os-db<br/>gerenciado · TLS · subnet privada")]
        end
    end

    Cliente -->|"HTTPS/REST + JWT"| GW
    GW -->|"POST /auth"| LambdaAuth
    GW -->|"POST /mail"| LambdaMail
    GW -->|"demais rotas (VPC Link)"| ALB
    ALB --> Pods
    LambdaAuth -->|"POST /internal/clientes/busca"| GW
    LambdaAuth -->|"mesmo JWT_SECRET"| SSM
    Pods -->|"SQL/TLS 5432"| RDS
    Pods -->|"comandos · respostas"| SQS
    Pods -->|"pull imagem"| ECR
    Pods -->|"lê segredos (via CD)"| SSM
    Pods -->|"POST /mail — notificação (best-effort)"| GW
    LambdaMail -->|"envia e-mail"| SMTP
    LambdaMail -->|"lê token + SMTP"| SSM
    Pods -.->|"métricas · logs · traces"| Obs
```

### Componentes da aplicação (C4)

#### Nível Container

```mermaid
graph TB
    classDef person fill:#08427B,stroke:#052E56,color:#fff,font-weight:bold
    classDef external fill:#999999,stroke:#6B6B6B,color:#fff
    classDef container fill:#438DD5,stroke:#3B7BC0,color:#fff,font-weight:bold
    classDef database fill:#438DD5,stroke:#3B7BC0,color:#fff,font-weight:bold

    Clientes["<b>Clientes HTTP</b><br/><i>[Person]</i><br/>Consumo autenticado (Swagger UI,<br/>curl, Postman com JWT) ou público<br/>(código da OS + placa via<br/>/public/ordens-servico)"]

    subgraph Oficina["Sistema Oficina"]
        API["<b>Oficina API</b><br/><i>[Container: NestJS / Node]</i><br/>Gestão de OS, clientes, veículos,<br/>serviços e itens de estoque"]
        DB[("<b>PostgreSQL 17</b><br/><i>[ContainerDb: Banco relacional]</i><br/>Persistência via Prisma 7<br/>com pg driver adapter")]
    end

    subgraph Externos["Sistemas externos"]
        Saga["<b>Billing e Execution Services</b><br/><i>[Microsserviços da Fase 4]</i><br/>Recebem comandos e respondem<br/>pelas filas SQS da Saga"]
        MailLambda["<b>Lambda de Notificações</b><br/><i>[External System]</i><br/>Recebe POST /mail (via API Gateway)<br/>e envia e-mails de finalização<br/>e entrega via SMTP"]
    end

    Clientes -->|"HTTPS / REST<br/>JSON + JWT (privado) ou<br/>código+placa (público)"| API
    API -->|"comandos (Amazon SQS)"| Saga
    Saga -->|"respostas (Amazon SQS)"| API
    API -->|"reads/writes<br/>TCP 5432 via Prisma"| DB
    API -->|"POST /mail<br/>JSON + x-mail-api-token"| MailLambda

    class Clientes person
    class Saga,MailLambda external
    class API container
    class DB database
```

#### Nível Component

Zoom dentro do Container **Oficina API** mostrando as quatro camadas da Clean Architecture. As relações tracejadas rotuladas como **implementa** representam a inversão de dependência: os adapters de infra implementam interfaces expostas pelo domain, e não o contrário.

```mermaid
graph TB
    classDef person fill:#08427B,stroke:#052E56,color:#fff,font-weight:bold
    classDef external fill:#999999,stroke:#6B6B6B,color:#fff
    classDef database fill:#438DD5,stroke:#3B7BC0,color:#fff,font-weight:bold
    classDef component fill:#85BBF0,stroke:#5D82A8,color:#000

    Cliente["<b>Cliente HTTP</b><br/><i>[Person]</i><br/>Consumo autenticado ou público"]

    subgraph OficinaAPI["Oficina API — NestJS [Container]"]
        direction TB

        subgraph InterfaceLayer["Camada Interface — src/modules/&lt;m&gt;/interface"]
            direction LR
            Controllers["<b>Controllers + Guards</b><br/><i>[Component: NestJS Controller]</i><br/>JwtAuthGuard, InternalTokenGuard<br/>+ RespostasSagaConsumer (fila SQS)"]
            DTOs["<b>DTOs de entrada e resposta</b><br/><i>[Component: class-validator]</i><br/>Validação declarativa de payload"]
        end

        subgraph ApplicationLayer["Camada Application — src/modules/&lt;m&gt;/application"]
            direction LR
            UseCases["<b>Use Cases</b><br/><i>[Component: @Injectable NestJS]</i><br/>1 classe = 1 responsabilidade,<br/>método execute — inclui o<br/>orquestrador da Saga"]
            Mappers["<b>Mappers de resposta</b><br/><i>[Component: TypeScript]</i><br/>toUserResponse etc"]
            Shared["<b>Shared helpers</b><br/><i>[Component: TypeScript]</i><br/>traduzirErroDominio, etc"]
        end

        subgraph DomainLayer["Camada Domain — src/modules/&lt;m&gt;/domain"]
            direction LR
            Entities["<b>Entities</b><br/><i>[Component: Classes puras]</i><br/>OrdemServico, Cliente, Veiculo etc"]
            DomainSvc["<b>Domain Services</b><br/><i>[Component: Funções puras]</i><br/>garantirCpfCnpjUnico, buscarClienteOuFalhar,<br/>maquinaDeEstadosOS, calcularTotaisOS"]
            Repos["<b>Repository & Adapter Interfaces (ports)</b><br/><i>[Component: Contratos TS + Errors tipados]</i><br/>Cliente/Veiculo/OS/User Repository (persistência)<br/>+ EmailSender, PasswordHasher, TokenIssuer (adapters)"]
        end

        subgraph ModuleInfra["Adapters por módulo — src/modules/&lt;m&gt;/infra"]
            direction LR
            Bcrypt["<b>BcryptPasswordHasher</b><br/><i>[Component: bcrypt]</i><br/>auth/infra e user/infra"]
            Jwt["<b>JwtTokenIssuer</b><br/><i>[Component: @nestjs/jwt]</i><br/>auth/infra"]
            Mailer["<b>NestMailerEmailSender</b><br/><i>[Component: fetch → Lambda de e-mail]</i><br/>mail/infra, provider EMAIL_SENDER"]
        end

        subgraph SharedInfra["Infra compartilhada — src/infra e src/modules/prisma"]
            direction LR
            PrismaSvc["<b>PrismaService</b><br/><i>[Component: pg.Pool + PrismaPg adapter]</i><br/>Bootstrap do Prisma Client"]
            PrismaRepos["<b>Prisma Repositories</b><br/><i>[Component: Prisma Client 7]</i><br/>src/infra/database/prisma/repositories"]
            Publicador["<b>PublicadorComandosSqs</b><br/><i>[Component: AWS SDK v3]</i><br/>src/infra/mensageria"]
        end
    end

    subgraph Externos["Sistemas externos"]
        direction TB
        DB[("<b>PostgreSQL 17</b><br/><i>[ContainerDb: Banco relacional]</i>")]
        MailLambda["<b>Lambda de Notificações</b><br/><i>[External System]</i><br/>Envia e-mail via SMTP"]
        SQSExt["<b>Amazon SQS</b><br/><i>[External System]</i><br/>filas de comandos e de respostas"]
    end

    Cliente -->|"HTTPS / REST"| Controllers
    Controllers -->|"valida entrada"| DTOs
    Controllers -->|"invoca"| UseCases
    UseCases -->|"usa"| DomainSvc
    UseCases -->|"depende de contratos"| Repos
    UseCases -->|"usa"| Mappers
    UseCases -->|"usa"| Shared
    DomainSvc -->|"opera sobre"| Entities

    PrismaRepos -.->|"implementa"| Repos
    Publicador -.->|"implementa (PublicadorComandos)"| Repos
    Bcrypt -.->|"implementa (PasswordHasher)"| Repos
    Jwt -.->|"implementa (TokenIssuer)"| Repos
    Mailer -.->|"implementa (EmailSender)"| Repos

    PrismaRepos -->|"usa Prisma Client"| PrismaSvc
    PrismaSvc -->|"TCP 5432 / pg driver"| DB
    Mailer -->|"POST /mail (HTTP + token)"| MailLambda
    Publicador -->|"SendMessage"| SQSExt

    class Cliente person
    class DB database
    class MailLambda,SQSExt external
    class Controllers,DTOs,UseCases,Mappers,Shared,Entities,DomainSvc,Repos,Bcrypt,Jwt,Mailer,PrismaSvc,PrismaRepos,Publicador component
```

### Infraestrutura provisionada na AWS

Recursos do cluster (namespace `oficina`) e as dependências gerenciadas. Tudo declarado em Terraform (repos de infra) e nos manifestos `k8s/` deste repo; o Secret é montado do SSM pelo pipeline no deploy.

```mermaid
graph TB
    subgraph AWS["AWS · us-east-1 · Terraform"]
        subgraph VPC["VPC — 2 AZs (us-east-1a / 1b)"]
            subgraph EKS["EKS — namespace oficina"]
                Ingress["Ingress → ALB Controller<br/>ALB internet-facing, target-type ip"]
                Svc["Service ClusterIP :3000"]
                Deploy["Deployment oficina-api<br/>2–10 réplicas · topologySpread por AZ<br/>securityContext: non-root, drop ALL caps"]
                HPA["HPA min 2 / max 10<br/>CPU 70% · memória 80%"]
                PDB["PodDisruptionBudget<br/>minAvailable 1"]
                CM["ConfigMap app-config"]
                Sec["Secret app-secret"]
                Job["Job db-migration<br/>prisma migrate deploy"]
                MS["metrics-server (HPA)"]
            end
            RDS[("RDS PostgreSQL oficina-os-db<br/>db.t4g.micro · subnet privada · TLS<br/>(terraform/ deste repositório)")]
        end
        ECR["ECR — imagem da API"]
        SSM["SSM /tc3-oficina/homolog/*<br/>DATABASE_URL · JWT_SECRET · MAIL_API_TOKEN<br/>INTERNAL_API_TOKEN · NEW_RELIC_LICENSE_KEY (SecureString)"]
        SQS["SQS — filas da Saga<br/>(terraform/ de cada serviço)"]
    end

    Ingress --> Svc --> Deploy
    HPA -.->|escala| Deploy
    PDB -.->|protege| Deploy
    Deploy -.->|envFrom| CM
    Deploy -.->|secretKeyRef| Sec
    Deploy -->|"SQL/TLS 5432"| RDS
    Deploy -->|pull imagem| ECR
    Deploy -->|"comandos e respostas"| SQS
    Sec -.->|sincronizado de| SSM
    Job -->|aplica migrations| RDS
    MS -.->|coleta métricas| Deploy
```

### Fluxo de deploy (CI/CD)

Dois workflows em `.github/workflows/`. `ci.yml` traz os checks `Build & Test` e `BDD (três serviços)` de cada PR; `cd.yml` roda a cada push em `develop`/`main` (ambas apontam para o mesmo ambiente único) e usa o próprio `ci.yml` como primeiro estágio, então cada commit é testado uma vez só antes de virar imagem e **deploy automático no EKS**. Autenticação na AWS por **OIDC** (sem chave estática); actions pinadas por SHA.

```mermaid
graph LR
    PR["PR para<br/>develop ou main"]
    Dev["Push/merge em<br/>develop ou main"]

    subgraph CI["ci.yml — checks do PR"]
        CIJob["Build & Test<br/>npm ci · prisma generate · lint<br/>unitários com cobertura (mínimo 80%)<br/>e2e com cobertura (PostgreSQL real)<br/>SonarQube Cloud + quality gate (PR e main) · build"]
        BDDJob["BDD (três serviços)<br/>OS, Billing e Execution no compose<br/>cenário Gherkin da abertura à entrega"]
    end

    subgraph CD["cd.yml — Delivery (só push)"]
        Guard["1 · CI<br/>o mesmo ci.yml"]
        Amb{"Ambiente na AWS<br/>role e cluster existem?"}
        Build["2 · Build & Push (ECR)<br/>OIDC · docker build linux/amd64<br/>push no ECR (tag = SHA)"]
        Deploy["3 · Deploy (EKS)<br/>update-kubeconfig<br/>Secret montado do SSM · configmap<br/>Job de migration (aguarda concluir)<br/>apply deployment/service/hpa/ingress/pdb<br/>rollout status + smoke test"]
        Pula["Pulado, com aviso"]
        Guard --> Build
        Amb -->|sim| Build
        Amb -->|não| Pula
        Build --> Deploy
    end

    PR --> CIJob
    PR --> BDDJob
    Dev --> Guard
    Dev --> Amb
    Deploy --> EKSc["Cluster EKS<br/>aplicação atualizada e validada"]
```

O ambiente da AWS só existe nas janelas de integração e demonstração. Sem o secret `AWS_ROLE_ARN` ou sem o cluster `tc3-oficina-homolog`, a imagem e o deploy são pulados com um aviso no resumo da execução, em vez de falhar a cada merge; qualquer outro erro falha o pipeline. O endereço do API Gateway (usado na URL da Lambda de e-mail) também vem do SSM, no parâmetro `API_GATEWAY_URL` publicado pela stack `tc3-auth-lambda`, porque muda quando a plataforma é recriada.

> Diagnóstico em falha: se um step do deploy quebra, um passo `if: failure()` dumpa `kubectl get all`, `describe pods`, eventos e logs do namespace. O **smoke test** exercita, contra o app deployado, health/readiness, login, criação de cliente (com normalização de CPF), abertura de OS com baixa de estoque, consulta pública, 401, a **Saga com o Execution Service de verdade** (a OS aberta vira tarefa de diagnóstico na fila do mecânico; a falha registrada no Execution volta pela fila de respostas, cancela a OS e devolve o estoque) e HPA/réplicas. Por isso, na subida do ambiente, o Execution é deployado antes do OS. A OS cancelada é excluída no fim; a tarefa fica no DynamoDB do Execution como `FALHOU`.

## Justificativa do banco de dados

**PostgreSQL** foi escolhido por:

- **Integridade referencial:** o domínio possui múltiplas entidades com relacionamentos complexos (OS → Cliente, Veículo, Serviços, Itens, Histórico). O PostgreSQL garante consistência com foreign keys e transações ACID, essencial para operações atômicas como baixa de estoque ao adicionar itens na OS.
- **Tipos nativos:** suporte a `UUID`, `DECIMAL` (valores monetários), `ENUM` (status da OS, tipo de item) e `TIMESTAMP WITH TIME ZONE` sem necessidade de workarounds.
- **Desempenho em consultas analíticas:** o relatório de tempo médio de execução usa agregações que o PostgreSQL lida com eficiência.
- **Ecossistema maduro:** integração consolidada com Prisma 7 (via driver adapter `@prisma/adapter-pg`) e documentação abrangente.

Na Fase 3 o banco passou de Postgres-em-cluster para **RDS PostgreSQL gerenciado** (subnet privada, TLS obrigatório, backups e métricas geridos pela AWS), provisionado no repositório [`tc3-infra-db`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-infra-db). A modelagem também foi **melhorada** (campo `status` em `Cliente`, snapshots imutáveis nas linhas da OS, numeração sequencial anual e políticas de exclusão explícitas).

Na Fase 4 este PostgreSQL passou a ser **só do OS Service**, e o Terraform dele veio para a pasta [`terraform/`](terraform/README.md) deste repositório (RDS `oficina-os-db`). O Billing tem o próprio PostgreSQL e o Execution usa DynamoDB; nenhum serviço lê o banco de outro (ver [A solução na Fase 4](#a-solução-na-fase-4)).

> **Justificativa formal completa + ajustes no modelo relacional:** ver **[RFC-003 — Escolha do banco de dados](docs/rfc/RFC-003-escolha-do-banco.md)**.

## Modelo de dados (Diagrama ER)

O schema (Prisma, `prisma/schema.prisma`) tem **10 entidades** e **4 enums**. O diagrama abaixo mostra as entidades e seus relacionamentos.

```mermaid
erDiagram
    Usuario ||--o{ OrdemServico : "cria"
    Usuario ||--o{ HistoricoStatusOS : "registra"
    Cliente ||--o{ Veiculo : "possui"
    Cliente ||--o{ OrdemServico : "é dono"
    Veiculo ||--o{ OrdemServico : "atendido em"
    OrdemServico ||--o{ OSServicos : "contém"
    OrdemServico ||--o{ OSItemEstoque : "contém"
    OrdemServico ||--o{ HistoricoStatusOS : "tem histórico"
    Servicos ||--o{ OSServicos : "referenciado por"
    ItemEstoque ||--o{ OSItemEstoque : "referenciado por"

    Usuario {
        uuid id PK
        string email UK
        string senhaHash
    }
    Cliente {
        uuid id PK
        string cpfCnpj UK
        enum tipoPessoa "FISICA|JURIDICA"
        enum status "ATIVO|INATIVO"
    }
    Veiculo {
        uuid id PK
        uuid clienteId FK
        string placa UK
    }
    Servicos {
        uuid id PK
        decimal precoBase
        int tempoEstimadoMin
        bool ativo
    }
    ItemEstoque {
        uuid id PK
        string sku UK
        enum tipo "PECA|INSUMO"
        int quantidadeEstoque
        int estoqueMinimo
    }
    OrdemServico {
        uuid id PK
        string codigo UK
        uuid clienteId FK
        uuid veiculoId FK
        uuid usuarioCriadorId FK
        enum status "8 estados"
        decimal valorTotal
        string correlationId "fluxo da Saga"
        datetime diagnosticoConcluidoAt "trava as linhas"
        datetime canceladaAt
        string motivoCancelamento
    }
    OSServicos {
        uuid id PK
        uuid ordemServicoId FK
        uuid servicoId FK
        string nomeSnapshot
        decimal precoUnitario
        decimal subtotal
    }
    OSItemEstoque {
        uuid id PK
        uuid ordemServicoId FK
        uuid itemEstoqueId FK
        string nomeSnapshot
        decimal precoUnitario
        decimal subtotal
    }
    HistoricoStatusOS {
        uuid id PK
        uuid ordemServicoId FK
        uuid usuarioId FK
        enum status
    }
    OSCodigoCounter {
        int ano PK
        int contador
    }
```

**Explicação dos relacionamentos:**

- **Cliente 1—N Veículo** e **Cliente 1—N OrdemServico:** um cliente tem vários veículos e várias OS. `onDelete: Restrict` — não se apaga um cliente que ainda tem veículo/OS.
- **Veículo 1—N OrdemServico:** cada OS é para um veículo; um veículo pode ter várias OS ao longo do tempo (`Restrict`).
- **Usuário 1—N OrdemServico / HistoricoStatusOS:** o funcionário que cria a OS e o autor de cada transição de status. (Sobre o ator em ações de cliente, ver [ADR-001](docs/adr/ADR-001-ator-trilha-auditoria.md).)
- **OrdemServico 1—N OSServicos / OSItemEstoque:** as **linhas** da OS (serviços e peças). Guardam `nomeSnapshot`/`precoUnitario` congelados no momento da inclusão. `onDelete: Cascade` — apagar a OS remove suas linhas.
- **OrdemServico 1—N HistoricoStatusOS:** a trilha cronológica de status (`Cascade`), base do relatório de tempo médio por status.
- **Servicos / ItemEstoque 1—N linhas:** o catálogo referenciado pelas linhas (`Restrict` — não se apaga um serviço/item usado em alguma OS).
- **OSCodigoCounter:** tabela isolada (sem FK), um contador por ano para gerar `codigo` sequencial da OS de forma transacional.

## Stack

| Camada | Tecnologia |
|---|---|
| **Runtime / Framework** | Node.js 24 · NestJS 11 · TypeScript |
| **Persistência** | Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL 17 |
| **Autenticação** | JWT HS256 (Passport) · bcrypt · função serverless (Lambda) por CPF |
| **Notificações** | Função serverless (Lambda de e-mail via `/mail`) · envio best-effort por HTTP |
| **Observabilidade** | `nestjs-pino` (logs JSON + correlationId) · **New Relic** (APM, métricas customizadas, traces distribuídos, dashboards e alertas) · endpoints `/health` e `/health/ready` |
| **Container** | Docker (multi-stage, non-root) · Docker Compose (local) |
| **Nuvem (AWS)** | **EKS** (Kubernetes 1.3x) · **RDS PostgreSQL** · **Lambda + API Gateway** · **ECR** · **SSM** · **ALB** |
| **IaC / CI-CD** | Terraform · GitHub Actions (OIDC, deploy no EKS) |
| **Mensageria (Saga)** | Amazon SQS (AWS SDK v3) · LocalStack no ambiente local |
| **Testes** | Jest (unitários e e2e) · Testcontainers (e2e com Postgres real) · Docker Compose com os três serviços (integração) · Cucumber (BDD) |
| **Qualidade** | ESLint · SonarQube Cloud no CI (cobertura e quality gate) |

## Pré-requisitos

**Desenvolvimento local:** Node.js 24+, npm 11+, Docker e Docker Compose.

**Para operar o deploy na AWS (EKS):** AWS CLI v2 (credenciais/OIDC), `kubectl`. A plataforma (VPC/EKS) fica no `tc3-infra-k8s`, e o RDS e as filas do OS na pasta [`terraform/`](terraform/README.md) deste repositório — ver [Repositórios](#repositórios).

## Execução local (Docker Compose)

Forma recomendada para rodar a aplicação localmente (o deploy na nuvem é automatizado pelo CI/CD — ver [Infraestrutura e deploy na AWS](#infraestrutura-e-deploy-na-aws-eks)).

```bash
# 1. Clonar o repositório
git clone https://github.com/fiap-soat-oficina-tech-challenge/tech-challenge-fiap.git
cd tech-challenge-fiap

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais (ver seção abaixo)

# 3. Subir todos os serviços (Postgres + LocalStack + API)
docker compose up -d
```

O compose cuida de tudo: sobe o Postgres e o LocalStack (SQS com as filas da Saga, criadas por `localstack/init/criar-recursos.sh`), aguarda os healthchecks, aplica as migrations no serviço one-shot `migrate` e só então inicia a API (mesmo papel do Job `db-migration` no cluster). Sozinho, o OS publica os comandos nas filas, mas ninguém os consome; para ver a Saga completa, use o [teste de integração dos três serviços](#teste-de-integração-dos-três-serviços). O usuário admin padrão (`admin@oficina.com` / `senha123`) é criado por uma migration, sem necessidade de seed manual.

A API estará disponível em `http://localhost:3000` e o Swagger UI em `http://localhost:3000/api`.

## Execução local (desenvolvimento)

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env

# 3. Subir o banco PostgreSQL e o LocalStack (filas da Saga)
docker compose up postgres localstack -d

# 4. Gerar o Prisma Client e aplicar migrations
npx prisma generate
npx prisma migrate dev

# 5. Iniciar a API em modo de desenvolvimento
npm run start:dev
```

> **Nota:** O docker-compose mapeia a porta do Postgres para `5433` no host. O `.env.example` já reflete isso. Se a porta `5433` estiver ocupada, ajuste no `docker-compose.yml` e no `.env`.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | não | Ambiente (`development` ou `production`) |
| `APPLICATION_PORT` | não | Porta exposta no host (default: `3000`) |
| `DATABASE_URL` | sim | String de conexão PostgreSQL (`postgresql://user:pass@host:5433/db?schema=public`) |
| `OFICINA_USER` | sim | Usuário do Postgres (usado pelo docker-compose) |
| `OFICINA_PASSWORD` | sim | Senha do Postgres (usado pelo docker-compose) |
| `OFICINA_DB` | sim | Nome do banco (usado pelo docker-compose) |
| `JWT_SECRET` | sim | Segredo para assinar tokens JWT |
| `JWT_EXPIRES_IN` | não | Expiração do token (default: `1h`) |
| `MAIL_LAMBDA_URL` | sim | URL da Lambda de notificações (rota `/mail` do API Gateway) para onde o app envia os e-mails |
| `MAIL_LAMBDA_TOKEN` | sim | Token de chamada da Lambda de e-mail (header `x-mail-api-token`) |
| `AWS_REGION` | sim | Região das filas da Saga |
| `SAGA_REPLIES_QUEUE_URL` | sim | Fila de respostas que o OS consome (`oficina-os-saga-replies`) |
| `EXECUTION_COMMANDS_QUEUE_URL` | sim | Fila de comandos do Execution (`oficina-execution-commands`) |
| `BILLING_COMMANDS_QUEUE_URL` | sim | Fila de comandos do Billing (`oficina-billing-commands`) |
| `AWS_ENDPOINT_URL` | só local | Aponta o SDK para o LocalStack; no cluster as credenciais vêm da role dos nós do EKS |
| `INTERNAL_API_TOKEN` | sim | Token das rotas `/internal` (header `x-internal-token`), usado pela Lambda de autenticação |
| `LOG_LEVEL` | não | Nível do pino (default: `info`) |
| `NEW_RELIC_ENABLED` | não | Liga o agente de APM, as métricas customizadas e a injeção de `trace.id`/`span.id` no log (default na imagem: `false`) |
| `NEW_RELIC_LICENSE_KEY` | com o agente ligado | Chave de ingestão do New Relic. **Só no `.env` (ignorado pelo git) ou no Secret do cluster** — nunca no `.env.example` |
| `NEW_RELIC_APP_NAME` | não | Nome no APM e valor do atributo `servico` (default: `oficina-api`) |
| `NEW_RELIC_LABELS` | não | Tags padrão (`environment:production;project:tech-challenge-fiap`): marcam a entidade no APM e viram os campos `environment`/`project` de toda linha de log |

> **Segurança:** `.env` e `.env.*` estão no `.gitignore` (a única exceção é o
> `.env.example`, sem valores reais) e no `.dockerignore` — a chave nunca entra
> no repositório nem na imagem. No `docker compose`, o `.env` é lido em runtime;
> no cluster, a chave vem do Secret `app-secret`, sincronizado do SSM pelo CD.

As notificações por e-mail são enviadas por uma **Lambda serverless** — ver [Notificações por e-mail (Lambda)](#notificações-por-e-mail-lambda).

## Notificações por e-mail (Lambda)

O envio de e-mail (finalização e entrega; na Fase 4 o orçamento e o QR Code de pagamento são enviados pelo Billing) **não é feito pelo app**: ele faz um `POST` autenticado para a **Lambda de notificações** — que fica no repositório [`tc3-auth-lambda`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-auth-lambda), **o mesmo da autenticação por CPF** (as duas Lambdas convivem lá, atrás do mesmo API Gateway) —, na rota `/mail`, e ela cuida do SMTP. O envio é **best-effort** — uma falha é registrada no log e **não bloqueia** a transição de status da OS (com timeout de 15s).

Duas variáveis controlam a integração:

| Variável | De onde vem |
|---|---|
| `MAIL_LAMBDA_URL` | ConfigMap no cluster; `.env` no local. É a rota `/mail` do API Gateway (output `mail_url` do Terraform da Lambda). |
| `MAIL_LAMBDA_TOKEN` | Secret `app-secret` no cluster (o CD lê do SSM `MAIL_API_TOKEN`); `.env` no local. Precisa casar com o token que a Lambda valida (header `x-mail-api-token`). |

A configuração de **SMTP** (host, usuário, senha — Ethereal para testes, ou um provedor real como Amazon SES/SendGrid) vive **na Lambda** (parâmetros no SSM), **não no app**. Ou seja, trocar o provedor de e-mail não toca no código nem no deploy da aplicação.

**Local:** aponte `MAIL_LAMBDA_URL`/`MAIL_LAMBDA_TOKEN` para a Lambda deployada, ou deixe valores quaisquer — o envio falha best-effort, sem quebrar o fluxo. Ao disparar um e-mail (a finalização, quando chega o `ReparoConcluido` da Saga, ou a entrega), o log registra o resultado:

```
LOG [NestMailerEmailSender] Email enviado via Lambda: notificação de finalização (OS: OS-2026-000001) para cliente@teste.com
```

## Autenticação

A API usa **JWT assinado em HS256** e suporta **dois fluxos de autenticação que coexistem**, distinguidos por uma _claim_ de tipo no token e aplicados por um único guard com controle de papel (`@Roles`). Ambos enviam o token no header `Authorization: Bearer <token>`.

### 1. Funcionários (admin) — email + senha

Usuários internos (atendentes, mecânicos, administradores) autenticam pela própria aplicação:

```bash
# Login (retorna accessToken)
POST /auth/login
{
  "email": "admin@oficina.com",
  "senha": "senha123"
}
```

O token administrativo carrega `{ sub, email }` e é resolvido como `tipo: "admin"`. O usuário admin padrão é criado automaticamente pela migration `seed_admin_user` ao aplicar as migrations.

### 2. Clientes — CPF (função serverless)

O cliente da oficina autentica **pelo CPF**, através de uma **função serverless (AWS Lambda)** exposta no API Gateway. Ela vive no repositório [`tc3-auth-lambda`](https://github.com/fiap-soat-oficina-tech-challenge/tc3-auth-lambda) — **o mesmo repositório que também hospeda a Lambda de notificações por e-mail** (`/mail`); são duas funções no mesmo projeto, atrás do mesmo API Gateway. O fluxo:

1. Cliente envia o CPF → `POST /auth` (API Gateway → Lambda)
2. A Lambda valida os dígitos do CPF, consulta o cliente no OS Service pela rota interna `POST /internal/clientes/busca` (sem ler o banco do OS — ver [Rota interna](#rota-interna-da-lambda-de-autenticação)) e verifica se está **ATIVO**
3. A Lambda assina um JWT **HS256** com o **mesmo segredo** que a aplicação usa para validar (compartilhado via AWS SSM Parameter Store) e devolve o token
4. O cliente usa esse token nas rotas protegidas por CPF

O token de cliente carrega `{ sub: <clienteId>, tipo: "cliente", cpf, nome }` e é resolvido como `tipo: "cliente"`. A aplicação **não emite** esse token — apenas o valida; a emissão é responsabilidade da Lambda.

### Modelo de papéis e propriedade (roles + ownership)

- O `JwtAuthGuard` valida o token e aplica o papel. **Sem `@Roles(...)` na rota, exige `admin`** — toda rota administrativa continua fechada ao cliente por padrão.
- `@Roles('cliente')` libera as rotas de cliente. Um token admin numa rota de cliente recebe **403**, e um token de cliente numa rota admin também recebe **403**.
- Nas rotas de cliente, além do papel, a aplicação valida **propriedade (ownership)**: o cliente só acessa as **próprias** OS (comparando o `clienteId` do token). OS de terceiros retornam **404** — sem revelar a existência do recurso.

### Fluxo de autenticação (diagrama de sequência)

Duas fases: a **emissão** do token pelo cliente (via função serverless) e o **consumo** de uma rota protegida na aplicação.

```mermaid
sequenceDiagram
    actor C as Cliente
    participant GW as API Gateway
    participant L as Lambda (auth CPF)
    participant APP as OS Service (NestJS)
    participant DB as Banco do OS (RDS)

    Note over L,APP: Lambda e serviços compartilham o mesmo<br/>JWT_SECRET (HS256) via SSM Parameter Store

    rect rgb(240, 245, 255)
    Note over C,DB: Fase 1 — Emissão do token (por CPF)
    C->>GW: POST /auth { cpf }
    GW->>L: encaminha
    L->>L: valida dígitos do CPF
    L->>APP: POST /internal/clientes/busca { cpf } (x-internal-token)
    APP->>DB: busca o cliente pelo CPF
    APP-->>L: { id, nome, status } ou 404
    alt CPF inválido
        L-->>C: 400 CPF inválido
    else Cliente não encontrado
        L-->>C: 404 não encontrado
    else status != ATIVO
        L-->>C: 403 inativo
    else Cliente ativo
        L->>L: assina JWT HS256 { sub, tipo:"cliente", cpf, nome }
        L-->>C: 200 { token, expiresIn, cliente }
    end
    end

    rect rgb(240, 255, 245)
    Note over C,DB: Fase 2 — Consumo de rota protegida
    C->>GW: GET /ordens-servico/minhas/:id (Bearer token)
    GW->>APP: encaminha (proxy)
    APP->>APP: JwtStrategy valida assinatura/expiração e resolve tipo=cliente
    APP->>APP: JwtAuthGuard (@Roles 'cliente') + ownership (ordem.clienteId == sub)
    alt token ausente ou inválido
        APP-->>C: 401
    else papel divergente (ex.: admin)
        APP-->>C: 403
    else OS de outro cliente
        APP-->>C: 404
    else autorizado
        APP->>DB: lê a OS com linhas e histórico
        APP-->>C: 200 OS detalhada
    end
    end
```

### Exemplo de uso (cliente por CPF)

```bash
# 1. Obter o token pelo CPF (API Gateway → função serverless)
curl -X POST https://<api-gateway>/auth \
  -H 'Content-Type: application/json' \
  -d '{ "cpf": "529.982.247-25" }'
# → 200 { "token": "<jwt-cliente>", "expiresIn": "1h", "cliente": { "id", "nome" } }
#   (400 CPF inválido | 404 não encontrado | 403 cliente inativo | 500 OS Service indisponível)

# 2. Listar as próprias OS
curl https://<api-gateway>/ordens-servico/minhas \
  -H 'Authorization: Bearer <jwt-cliente>'

# 3. Aprovar o orçamento da própria OS (Billing Service, na Fase 4)
curl https://<api-gateway>/billing/orcamentos?osId=<osId> \
  -H 'Authorization: Bearer <jwt-cliente>'
curl -X POST https://<api-gateway>/billing/orcamentos/<orcamentoId>/aprovar \
  -H 'Authorization: Bearer <jwt-cliente>'
# → 200 com o qrCode do Mercado Pago (conteúdo e imagem) | 403 token admin | 404 orçamento de outro cliente
```

> A distinção admin/cliente é feita na `JwtStrategy` (pela presença de `tipo: "cliente"` vs `email` no payload) e o controle de acesso no `JwtAuthGuard` + decorator `@Roles`. Ver a [RFC-001](docs/rfc/RFC-001-estrategia-autenticacao.md) para a estratégia completa — alternativas consideradas, consequências e riscos.

## Documentação da API

O Swagger UI documenta todas as rotas da API e permite executá-las direto do navegador. Os corpos de entrada vêm com os DTOs de validação (formatos como `uuid`, `email` e `date`, enums e exemplos), e cada rota lista os códigos HTTP de resposta. O formato do corpo da resposta está documentado nas rotas de usuários, na consulta pública, no relatório de tempo médio e na rota interna; nas demais, o Swagger mostra o código e a descrição de cada resposta.

- **Swagger UI (interativo):** `http://localhost:3000/api` — permite executar cada endpoint direto do browser após autenticar via `Authorize` com o `accessToken` do login
- **OpenAPI JSON (para importar em Postman/Insomnia):** `http://localhost:3000/api-json`

## Documentação de arquitetura

As decisões da Fase 4 (divisão dos serviços, tecnologias, Saga orquestrada e compensações) estão em [A solução na Fase 4](#a-solução-na-fase-4), e os contratos entre os serviços em [`docs/contratos.md`](docs/contratos.md): filas, envelope das mensagens, os 5 comandos e as 10 respostas, a tabela de transições do orquestrador e as rotas REST.

As decisões da Fase 3, que continuam valendo, estão registradas em Markdown na pasta [`docs/`](docs/). **RFCs** documentam decisões técnicas relevantes (com contexto, alternativas e consequências); **ADRs** registram decisões arquiteturais permanentes.

**RFCs — [`docs/rfc/`](docs/rfc/)**

| RFC | Assunto |
|---|---|
| [RFC-001 — Estratégia de autenticação](docs/rfc/RFC-001-estrategia-autenticacao.md) | Autenticação dupla (funcionário email/senha + cliente por CPF via função serverless), formato dos tokens, papéis/propriedade e integração Lambda↔SSM. Inclui o **diagrama de sequência** do fluxo de auth. |
| [RFC-002 — Escolha da nuvem](docs/rfc/RFC-002-escolha-da-nuvem.md) | Por que **AWS**, mapeamento dos requisitos para os serviços (EKS, RDS, Lambda, API Gateway, ECR, SSM), alternativas (GCP, Azure) e trade-offs. |
| [RFC-003 — Escolha do banco](docs/rfc/RFC-003-escolha-do-banco.md) | Justificativa formal de **PostgreSQL + RDS gerenciado** e os **ajustes no modelo relacional**. |

**ADRs — [`docs/adr/`](docs/adr/)**

| ADR | Decisão |
|---|---|
| [ADR-001 — Ator da trilha de auditoria](docs/adr/ADR-001-ator-trilha-auditoria.md) | Por que o histórico registra o `usuarioCriadorId` (funcionário) em ações de cliente. |
| [ADR-002 — Uso de HPA](docs/adr/ADR-002-uso-de-hpa.md) | Escalabilidade horizontal por HPA (CPU/memória), min/max de réplicas e trade-offs. |
| [ADR-003 — Padrão de comunicação](docs/adr/ADR-003-padrao-de-comunicacao.md) | Comunicação síncrona REST/JSON stateless com JWT; auth desacoplada por segredo compartilhado; webhook e email best-effort. |

## Endpoints da API

### Auth
| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | Autenticar usuário e obter token JWT |

### Usuários (JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/user` | Listar todos |
| GET | `/user/:id` | Buscar por ID |
| POST | `/user` | Criar — retorna `{ user, senhaGerada }` com a senha em texto puro exibida apenas nesta resposta |
| PUT | `/user/:id` | Atualizar (parcial: email e nome opcionais) |
| DELETE | `/user/:id` | Deletar (204) |

### Clientes (JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/cliente` | Listar todos |
| GET | `/cliente/:id` | Buscar por ID |
| POST | `/cliente` | Criar (com validação de CPF/CNPJ e unicidade; 409 se já cadastrado) |
| PUT | `/cliente/:id` | Atualizar (parcial) |
| DELETE | `/cliente/:id` | Deletar (204) |

### Veículos (JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/veiculos` | Listar todos |
| GET | `/veiculos/:id` | Buscar por ID |
| POST | `/veiculos` | Criar (com validação de placa Mercosul/tradicional; 409 se placa já cadastrada) |
| PUT | `/veiculos/:id` | Atualizar (parcial) |
| DELETE | `/veiculos/:id` | Deletar (204) |

### Serviços (JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/servicos` | Listar todos |
| GET | `/servicos/:id` | Buscar por ID |
| POST | `/servicos` | Criar |
| PUT | `/servicos/:id` | Atualizar (parcial) |
| DELETE | `/servicos/:id` | Deletar (204) |

### Itens de Estoque (JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/itens-estoque` | Listar (filtro opcional por tipo: `PECA` ou `INSUMO`) |
| GET | `/itens-estoque/baixo-estoque` | Listar itens abaixo do estoque mínimo |
| GET | `/itens-estoque/:id` | Buscar por ID |
| POST | `/itens-estoque` | Criar (SKU único; 409 se já cadastrado) |
| PUT | `/itens-estoque/:id` | Atualizar (parcial; 409 se novo SKU pertencer a outro item) |
| DELETE | `/itens-estoque/:id` | Deletar (soft delete via `ativo: false`) |

### Ordens de Serviço — Funcionários (JWT admin)
Rotas administrativas (papel `admin` por padrão; token de cliente recebe **403**).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/ordens-servico` | Listar OS ativas: ordenadas por prioridade de status (`EM_EXECUCAO > AGUARDANDO_PAGAMENTO > AGUARDANDO_APROVACAO > EM_DIAGNOSTICO > RECEBIDA`) e mais antigas primeiro dentro do mesmo status. Exclui OS `FINALIZADA`, `ENTREGUE` e `CANCELADA`. |
| GET | `/ordens-servico/:id` | Buscar por ID (com detalhes, linhas e histórico) |
| POST | `/ordens-servico` | Criar por CPF/CNPJ + placa, com serviços e peças opcionais (baixa atômica de estoque). Inicia a Saga: publica `IniciarDiagnostico`. O header `x-correlation-id` vira o fluxo da OS |
| PUT | `/ordens-servico/:id` | Atualizar observações |
| DELETE | `/ordens-servico/:id` | Deletar, só OS `CANCELADA` (409 nas demais: a exclusão deixaria a Saga órfã) |
| POST | `/ordens-servico/:id/servicos` | Adicionar serviço à OS. As rotas de serviços e itens só valem em `RECEBIDA` e `EM_DIAGNOSTICO`, até o diagnóstico concluído (409 depois) |
| PUT | `/ordens-servico/:id/servicos/:linhaId` | Atualizar quantidade de serviço |
| DELETE | `/ordens-servico/:id/servicos/:linhaId` | Remover serviço da OS |
| POST | `/ordens-servico/:id/itens-estoque` | Adicionar item de estoque (com baixa atômica) |
| PUT | `/ordens-servico/:id/itens-estoque/:linhaId` | Atualizar quantidade de item (ajusta estoque por delta) |
| DELETE | `/ordens-servico/:id/itens-estoque/:linhaId` | Remover item (restitui estoque) |
| POST | `/ordens-servico/:id/cancelar` | Cancelar OS que espera o cliente (`AGUARDANDO_APROVACAO` ou `AGUARDANDO_PAGAMENTO`), com `{ motivo }`: devolve o estoque e publica `CancelarOrcamento` |
| POST | `/ordens-servico/:id/transicao-status` | Registrar a entrega (`FINALIZADA` → `ENTREGUE`). As demais transições vêm da Saga (409) |

### Ordens de Serviço — Cliente (autenticação por CPF)
Rotas protegidas por token de cliente (`@Roles('cliente')`) **e** por propriedade: o cliente só opera as próprias OS. Token admin recebe **403**; OS de outro cliente retorna **404**.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/ordens-servico/minhas` | Listar as próprias OS (filtradas pelo `clienteId` do token), das mais recentes às mais antigas |
| GET | `/ordens-servico/minhas/:id` | Detalhar uma OS própria (linhas, totais e histórico de status) |

A aprovação e a recusa do orçamento saíram daqui na Fase 4: são feitas no Billing, em `POST /billing/orcamentos/{id}/aprovar` e `/recusar`.

### Acompanhamento Público (sem JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/public/ordens-servico/:codigo?placa=` | Consultar OS pelo código e placa (dupla checagem, sem dados sensíveis de terceiros) |

### Interno (Lambda de autenticação)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/internal/clientes/busca` | Busca o cliente pelo CPF (no corpo) e devolve `{ id, nome, status }`. Autenticado pelo header `x-internal-token` |

O webhook externo de aprovação de orçamento passou para o Billing: `POST /billing/webhooks/orcamento`, com o mesmo corpo.

### Relatórios (JWT)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/ordens-servico/relatorios/tempo-medio-servicos` | Tempo médio de execução por serviço (com filtros opcionais `dataInicio`, `dataFim`, `servicoId`) |

## Fluxo da Ordem de Serviço

```
RECEBIDA → EM_DIAGNOSTICO → AGUARDANDO_APROVACAO → AGUARDANDO_PAGAMENTO → EM_EXECUCAO → FINALIZADA → ENTREGUE
                                                                             (ou CANCELADA, por compensação)
```

Na Fase 4 as transições vêm da Saga, a partir das respostas do Billing e do Execution. O ciclo completo, os eventos de cada transição e as compensações estão em [Ciclo da OS](#ciclo-da-os) e [Transições e compensações](#transições-e-compensações). Pela API, o funcionário só registra a entrega e cancela OS que esperam o cliente.

Cada transição registra um `HistoricoStatusOS` com data, usuário e observação. As transições da Saga usam o criador da OS como usuário e dizem na observação quem agiu (ADR-001). Os e-mails são enviados pela Lambda de notificações e são best-effort: uma falha no envio não bloqueia a transição de status.

### Diagrama de sequência — abertura de OS

Fluxo do `POST /ordens-servico`: um funcionário abre a OS por **CPF/CNPJ + placa**, opcionalmente já com serviços e peças. O cliente e o veículo são validados primeiro; a criação em si — validação de serviços/itens, geração do código, criação das linhas com snapshots, baixa de estoque, totais e a publicação do primeiro comando da Saga — roda dentro de uma **única transação atômica** (`createComItens`), que reverte por completo se qualquer item estiver indisponível ou se a publicação falhar.

```mermaid
sequenceDiagram
    actor F as Funcionário (admin)
    participant API as API (NestJS · EKS)
    participant DB as RDS (PostgreSQL)
    participant SQS as SQS (oficina-execution-commands)

    F->>API: POST /ordens-servico (Bearer admin)<br/>{ cpfCnpj, placa, servicos[], itens[] }
    API->>API: JwtAuthGuard (admin) · valida DTO · normaliza CPF/placa
    API->>DB: busca Cliente por cpfCnpj
    alt cliente não encontrado
        API-->>F: 404 cliente não encontrado
    end
    API->>DB: busca Veículo por placa
    alt veículo não encontrado
        API-->>F: 404 veículo não encontrado
    else veículo não pertence ao cliente
        API-->>F: 422
    end
    rect rgb(240, 245, 255)
    Note over API,DB: createComItens — transação atômica única
    API->>DB: valida serviços ativos e itens (estoque suficiente)
    API->>DB: gera código (OSCodigoCounter do ano) · cria OS (RECEBIDA)
    API->>DB: cria linhas (OSServicos/OSItemEstoque) com snapshots · baixa de estoque
    API->>DB: calcula/grava totais · HistoricoStatusOS inicial
    API-)SQS: IniciarDiagnostico (antes do commit)
    end
    alt item/serviço indisponível ou estoque insuficiente
        API-->>F: 422 (transação revertida)
    else publicação falhou
        API-->>F: 500 (transação revertida)
    else sucesso
        API-->>F: 201 { id, codigo, status: RECEBIDA, valorTotal }
    end
```

## Observabilidade

A aplicação escreve **um JSON por linha** no stdout, via `nestjs-pino`. No
cluster, o Fluent Bit do `nri-bundle` recolhe e entrega ao New Relic, que
desestrutura o JSON em atributos consultáveis — nada é escrito em arquivo e não
há CloudWatch no caminho.

```json
{"level":"info","timestamp":1789243924881,"servico":"oficina-api",
 "environment":"production","project":"tech-challenge-fiap",
 "correlationId":"7d2f…","trace.id":"9a1c…","span.id":"4f70…","entity.name":"oficina-api",
 "evento":"ordem_servico.criada","ordem_id":"os-1","codigo":"OS-2026-000042",
 "message":"ordem_servico.criada"}
```

| Campo | De onde vem |
|---|---|
| `level`, `timestamp`, `servico` | Configuração do pino em `src/app.module.ts` — os nomes seguem o que o New Relic indexa nativamente |
| `environment`, `project` | Tags padrão, lidas de `NEW_RELIC_LABELS` (a mesma variável das tags da entidade no APM) |
| `correlationId` | Nas requisições, o id do pino-http (`quietReqLogger`), que reaproveita o `x-correlation-id` recebido ou gera um. No consumo das respostas da Saga, o `correlationId` do envelope da mensagem (`contexto-fluxo.ts`), que é o da OS |
| `osId` | Só no consumo de mensagens: a OS da mensagem |
| `trace.id`, `span.id`, `entity.*` | `mixin` chamando `newrelic.getLinkingMetadata()` — liga o log ao trace distribuído; com um `traceparent` W3C recebido, o `trace.id` é o do cliente |
| `evento` + campos em `snake_case` | Evento de negócio emitido pelo caso de uso |

O agente sobe por `node -r newrelic dist/src/main.js` — o CMD da imagem, em
forma exec —, **antes** de qualquer módulo da aplicação: é essa ordem que
permite a ele instrumentar Express e Prisma no momento em que são importados.
As migrations não rodam mais no CMD: no cluster ficam no Job `db-migration`, e
no `docker compose` no serviço `migrate`. Assim o stdout da API é só JSON e o
Node recebe o SIGTERM direto (desligamento gracioso, com flush do agente).

**Métricas customizadas** (APM, `Custom/OrdemServico/*`): criação de OS, tempo
em cada status (medido no commit de toda transição — da Saga ou manual —, desde a
primeira entrada do status atual no histórico), lead time até a entrega e falhas
por etapa. Detalhes, nomes e consultas NRQL em `tc3-infra-k8s/OBSERVABILIDADE.md`.

**Fluxo distribuído:** o `correlationId` nasce na abertura da OS, fica gravado
nela e vai em toda mensagem da Saga. O Billing e o Execution escrevem o mesmo id
nos seus logs, então filtrar por ele no New Relic mostra a OS nos três serviços
(ver [Rastreamento distribuído](#rastreamento-distribuído)).

Eventos de negócio (`registrarEvento` / `registrarFalha`, em
`src/common/observability/`) saem pelo mesmo logger da requisição, e por isso
herdam o `correlationId` e os campos de trace sem que nenhum caso de uso precise
receber o logger no construtor.

Em desenvolvimento nada disso está ligado: sem `NEW_RELIC_ENABLED=true` o pacote
nem é carregado, e o log sai igual, só que sem os campos de trace. Em teste
unitário os eventos viram no-op, porque `configurarTelemetria` só é chamado no
bootstrap.

Endpoints de saúde, usados pelas probes do Kubernetes, pelo health check do ALB
e pelo monitor de Synthetics:

| Rota | Uso |
|---|---|
| `GET /health` | Liveness raso — não toca no banco |
| `GET /health/ready` | Readiness — `SELECT 1`, responde 503 se o banco cai |

O desenho completo — agentes, dashboard, alertas e o contrato dos campos — está
no repositório de infraestrutura, em `tc3-infra-k8s/OBSERVABILIDADE.md`.

## Testes

Resultado atual:

- **436 testes unitários** (103 suítes). O orquestrador da Saga tem um teste por linha da [tabela de transições](#transições-e-compensações).
- **66 testes end-to-end** (10 suítes) com PostgreSQL real (Testcontainers), também no CI. As respostas do Billing e do Execution são simuladas na fronteira da fila (`responderSaga`), e os comandos publicados ficam num publicador em memória (`ctx.comandos`). Cobrem a Saga de ponta a ponta, as compensações (estoque devolvido, cancelamento, estorno pedido), a trava das linhas, a persistência da Saga (`saga-persistencia.e2e-spec.ts`) e os repositórios Prisma.
- **Teste de integração com os três serviços** ([`test/integracao/`](test/integracao/)): 44 verificações com OS, Billing e Execution de verdade, LocalStack e o simulador do Mercado Pago (ver [Teste de integração dos três serviços](#teste-de-integração-dos-três-serviços)).
- **BDD do fluxo completo** ([`test/bdd/`](test/bdd/)): um cenário em Gherkin, com 25 passos, da abertura à entrega, com os três serviços juntos, rodando no CI (ver [BDD do fluxo completo](#bdd-do-fluxo-completo)).

### Cobertura

| Medição | Linhas | Instruções | Branches | Funções |
|---|---|---|---|---|
| Unitários (`npm run test:cov`) | 82,4% | 82,2% | 63,0% | 75,0% |
| E2E (`npm run test:e2e:cov`) | 79,5% | 79,6% | 60,1% | 77,4% |
| **Unitários + e2e** (`npm run test:cov:total`) | **94,9%** | **94,7%** | **73,8%** | **93,9%** |

O número do serviço é o dos dois juntos: os repositórios Prisma (`src/infra`) são testados pelos e2e, contra um PostgreSQL de verdade, e não pelos unitários. É também a soma que o [SonarQube Cloud](https://sonarcloud.io/summary/overall?id=fiap-soat-oficina-tech-challenge_tech-challenge-fiap&branch=main) recebe do CI (os dois relatórios lcov). O Jest dos unitários sozinho já falha abaixo de 80% de linhas e instruções (`coverageThreshold`). Ficam fora da conta o código gerado do Prisma, o dublê do cliente Prisma, os `*.module.ts`, `index.ts` e `main.ts`. Os branches que faltam nos controllers são os metadados que o TypeScript gera para os decorators (`typeof X === "undefined" ? Object : X`), que nenhum teste alcança.

Relatório do Istanbul (Jest) com unitários e e2e somados, gerado em 06/11/2026:

![Cobertura do OS Service: unitários e e2e somados](docs/cobertura.png)

```bash
# Todos os testes unitários
npm test

# Unitários com cobertura (coverage/)
npm run test:cov

# Testes end-to-end (usa Testcontainers, requer Docker rodando)
npm run test:e2e

# E2E com cobertura (coverage-e2e/) e o relatório somado (coverage-total/index.html)
npm run test:e2e:cov
npm run test:cov:total

# Integração com os três serviços (requer Docker e os repositórios do Billing e do Execution)
cd test/integracao && docker compose -p oficina-integracao up -d --build && bash teste-saga.sh

# BDD do fluxo completo (com o mesmo compose no ar)
BDD_JWT_SECRET=segredo-de-integracao npm run test:bdd

# Teste específico
npx jest src/path/to/file.spec.ts
```

## Scripts disponíveis

| Script | Descrição |
|---|---|
| `npm run start:dev` | Dev server com watch mode |
| `npm run start:debug` | Dev server com debugger |
| `npm run build` | Build de produção |
| `npm run start:prod` | Executar build de produção |
| `npm run lint` | ESLint com auto-fix |
| `npm run format` | Prettier |
| `npm test` | Testes unitários |
| `npm run test:cov` | Testes unitários com cobertura (mínimo 80%) |
| `npm run test:e2e` | Testes end-to-end |
| `npm run test:e2e:cov` | Testes end-to-end com cobertura |
| `npm run test:cov:total` | Relatório de cobertura somando unitários e e2e |
| `npm run test:bdd` | BDD do fluxo completo (três serviços no ar pelo compose de `test/integracao/`) |

---

## Infraestrutura e deploy na AWS (EKS)

O deploy é **automático via CI/CD**: todo push em `develop` ou `main` dispara o `cd.yml`, que roda o CI, builda a imagem, publica no **ECR** e faz o rollout no **EKS** (as duas branches entregam no **mesmo ambiente único**). A plataforma (VPC, EKS, node group, ECR, OIDC, budget) é provisionada por **Terraform** no `tc3-infra-k8s`, e o RDS, as filas e os parâmetros do OS na pasta [`terraform/`](terraform/README.md) deste repositório — ver [Repositórios](#repositórios).

> **Ambiente único.** Conforme validado com o professor na Fase 3, há **um único ambiente** na AWS — a distinção entre homologação e produção foi desconsiderada. As branches `develop` e `main` fazem **deploy automático** para esse mesmo ambiente (o deploy da `main` é rotulado como "production" no GitHub).

### Pipelines (GitHub Actions)

Dois workflows em `.github/workflows/`, cada um com seu `concurrency`. Actions pinadas por SHA; autenticação na AWS por **OIDC** (sem chave estática).

#### `ci.yml` — Integração
| Aspecto | Valor |
|---|---|
| **Trigger** | `pull_request` para `main`/`develop`, e chamado pelo `cd.yml` (`workflow_call`) |
| **Job `Build & Test`** | `npm ci` → `prisma generate` → lint → unitários com cobertura (mínimo 80%) → e2e com cobertura → **SonarQube Cloud** com quality gate (em PR e no push da `main`) → `npm run build` |
| **Job `BDD (três serviços)`** | Constrói OS, Billing e Execution e roda o cenário Gherkin da abertura à entrega |

#### `cd.yml` — Entrega (deploy automático no EKS)
| Aspecto | Valor |
|---|---|
| **Trigger** | `push` em `main`/`develop` (não roda em PR) |
| **Jobs** | `CI` (o próprio `ci.yml`) e `Ambiente na AWS` → `Build & Push (ECR)` → `Deploy (EKS)`, com os deploys serializados por `concurrency: deploy-homolog` |

**Estágios do `cd.yml`:**

| Estágio | O que faz |
|---|---|
| **CI** | Roda o `ci.yml` inteiro antes de empacotar — push quebrado não gera imagem nem deploy. |
| **Ambiente na AWS** | Confere se a role de deploy e o cluster existem. Fora das janelas em que o ambiente está no ar, a imagem e o deploy são pulados com um aviso, e o pipeline fica verde. |
| **Build & Push (ECR)** | `configure-aws-credentials` (OIDC) → login no ECR → `docker build --platform linux/amd64` → push no ECR com tag = SHA do commit. |
| **Deploy (EKS)** | `aws eks update-kubeconfig` → monta o `Secret` a partir do **SSM** (com `sslmode=require`) → aplica o ConfigMap → roda o **Job de migration** e **aguarda concluir** → aplica `deployment/service/hpa/ingress/pdb` → `rollout status` → **smoke test** (health/readiness, login, criação de cliente com normalização de CPF, abertura de OS com baixa de estoque, consulta pública, 401, a Saga com o Execution Service e HPA/réplicas). Em falha, um passo `if: failure()` dumpa pods/eventos/logs. |

**Pré-requisitos do pipeline** (configurados uma vez): o secret de repositório **`AWS_ROLE_ARN`** (role OIDC do bootstrap, com acesso ao EKS via *access entry*) e o **trust da role** incluindo este repositório. Sem isso, o `cd.yml` falha em `configure-aws-credentials`.

### Manifestos Kubernetes (`k8s/`)

| Arquivo | Recurso |
|---|---|
| `00-namespace.yaml` | Namespace `oficina` |
| `app/01-configmap.yaml` | ConfigMap (variáveis não sensíveis) |
| `app/03-migration-job.yaml` | Job one-shot `prisma migrate deploy` (roda **de dentro** do cluster, pois o RDS é privado) |
| `app/04-deployment.yaml` | Deployment (2–10 réplicas, probes `/health`, `securityContext`, `topologySpread`) |
| `app/05-service.yaml` | Service ClusterIP :3000 |
| `app/06-hpa.yaml` | HorizontalPodAutoscaler (CPU 70% / memória 80%) |
| `app/07-ingress.yaml` | Ingress ALB internet-facing (healthcheck `/health`) |
| `app/08-pdb.yaml` | PodDisruptionBudget `minAvailable: 1` |

> O `Secret` **não é versionado**: o pipeline o monta no momento do deploy a partir do **SSM Parameter Store** (`DATABASE_URL`, `JWT_SECRET`, `NEW_RELIC_LICENSE_KEY`, `MAIL_API_TOKEN` → `MAIL_LAMBDA_TOKEN` e `INTERNAL_API_TOKEN`, gerado pelo `terraform/` deste repositório). As URLs das filas da Saga ficam no ConfigMap, e o acesso às filas vem da role dos nós do EKS (política em `terraform/iam.tf`). O `JWT_SECRET` e o `MAIL_API_TOKEN` são os **mesmos** que as Lambdas de auth e de e-mail usam — por isso vêm do SSM, e não chumbados. As migrations ficam a cargo do **Job** (a imagem só faz `start`); ver [ADR-002](docs/adr/ADR-002-uso-de-hpa.md) sobre o HPA e a [RFC-001](docs/rfc/RFC-001-estrategia-autenticacao.md) sobre o segredo compartilhado.

### Operar o cluster manualmente (kubectl)

Após configurar as credenciais (`aws configure`), conecte o `kubectl` ao EKS:

```bash
aws eks update-kubeconfig --region us-east-1 --name tc3-oficina-homolog
kubectl get pods -n oficina
kubectl get hpa,pdb,ingress -n oficina
kubectl logs -n oficina -l app=oficina-api --tail=50   # logs JSON
```

### Endereços do ambiente

O ambiente é recriado a cada subida (workflow **Ambiente** do `tc3-infra-k8s`), e com ele o API Gateway e o ALB, então os endereços mudam. O atual fica no SSM:

```bash
aws ssm get-parameter --name /tc3-oficina/homolog/API_GATEWAY_URL --query Parameter.Value --output text
```

Pelo API Gateway: autenticação em `/auth`, as rotas do OS na raiz (Swagger em `/api`), as do Billing em `/billing` (Swagger em `/billing/api`) e as do Execution em `/execution` (Swagger em `/execution/api`).

### Desenvolvimento local em Kubernetes (opcional, Kind)

O diretório `infra/` mantém um Terraform que provisiona um cluster **Kind** local (efêmero) para testar os manifestos sem a AWS. É opcional e independente do deploy na nuvem — o caminho recomendado para desenvolvimento é o [Docker Compose](#execução-local-docker-compose).
