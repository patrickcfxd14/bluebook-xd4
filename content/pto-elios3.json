# Blue Book — Portal de Operações XD4Solutions

Este repositório contém o Portal de Operações (Blue Book) da XD4Solutions, reestruturado
para que **os documentos (POP, TOP, MGO) possam ser atualizados direto no Word**, sem
precisar editar código.

## Como funciona agora

```
├── index.html                          ← o site em si (raramente precisa mudar)
├── content/                            ← conteúdo de cada documento, em JSON
│   ├── mgo.json
│   ├── pop-elios2.json
│   ├── pop-elios3.json
│   ├── pop-g1.json
│   ├── pop-go2.json
│   └── pto-elios3.json
├── documentos-fonte/                   ← os arquivos Word "de verdade"
│   ├── POP_ELIOS_2.docx
│   ├── POP_ELIOS_3.docx
│   ├── POP_ROBO_G1.docx
│   ├── POP_ROBO_GO2.docx
│   └── PTO_ELIOS_3.docx
├── scripts/
│   └── docx_to_json.py                 ← o "tradutor" de Word para o formato do site
└── .github/workflows/
    └── converter-docs.yml              ← o "robô" que roda o tradutor sozinho
```

**O `index.html` não tem mais o conteúdo dos documentos dentro dele.** Ele carrega cada
documento do arquivo JSON correspondente, na hora que você clica para abrir. Isso quer dizer:

- O `index.html` fica pequeno e estável — quase nunca precisa mexer nele.
- Cada documento tem seu próprio arquivo, fácil de encontrar e de revisar no histórico do Git.
- Atualizar um documento não exige tocar em código nenhum.

## Como atualizar um documento (fluxo normal, sem precisar de mim)

1. Abra o `.docx` correspondente (na pasta `documentos-fonte/`) no Word, no seu computador.
2. Faça as edições normalmente — corrigir texto, adicionar seção, mudar uma tabela, etc.
   **Importante:** mantenha o padrão de títulos que já existe (`1. TÍTULO`, `1.1 Subtítulo`,
   `1.1.1 Sub-subtítulo`, sempre usando o estilo "Título 1" do Word para todos eles — é
   assim que o robô reconhece a estrutura de capítulos).
3. Salve o arquivo Word.
4. No site do GitHub, entre na pasta `documentos-fonte/`, clique no arquivo antigo e
   substitua pelo novo (ou arraste o arquivo novo para a pasta, com o **mesmo nome**).
5. Espere 1 a 2 minutos. O robô (GitHub Action) já converteu o Word automaticamente e
   atualizou o `content/*.json` correspondente — o site publicado já reflete a mudança.

Você pode acompanhar o andamento da conversão na aba **Actions** do repositório no GitHub.

## Como adicionar um documento novo (ex: TOP do Elios 2)

1. Crie o `.docx` seguindo o mesmo padrão visual e de títulos dos documentos existentes
   (pode copiar um already-existente como modelo e reescrever o conteúdo).
2. Suba esse arquivo na pasta `documentos-fonte/`, com um nome descritivo
   (ex: `TOP_ELIOS_2.docx`).
3. O robô vai gerar automaticamente `content/top-elios-2.json`.
4. **Esta última parte ainda precisa de uma edição pequena no `index.html`**: adicionar
   o item na árvore de navegação (poucas linhas, perto do início do arquivo, onde já
   estão listados os outros documentos) e uma função `renderTOPElios2()` de duas linhas
   (copiando o padrão de `renderPTOElios3()` já existente). Me chame quando chegar nesse
   ponto — é rápido, ou posso te ensinar a fazer isso sozinho também.

## Publicando o site (GitHub Pages)

Para o carregamento dos arquivos `content/*.json` funcionar, o site **precisa** ser aberto
através de um servidor web (não pode ser aberto com duplo clique no arquivo — navegadores
bloqueiam esse tipo de carregamento por segurança quando o endereço começa com `file://`).

O jeito mais simples é usar o **GitHub Pages**, gratuito:
1. No repositório, vá em **Settings → Pages**.
2. Em "Source", selecione a branch `main` e a pasta `/ (root)`.
3. Salve. Em alguns minutos, o GitHub te dá uma URL (tipo
   `https://seuusuario.github.io/nome-do-repo/`) onde o site já funciona.

## Requisitos técnicos do conversor (`scripts/docx_to_json.py`)

- Usa o [pandoc](https://pandoc.org) para ler o `.docx` (já vem instalado automaticamente
  no robô do GitHub; se quiser rodar na sua máquina, precisa instalar o pandoc também).
- Usa a biblioteca Python `beautifulsoup4`.
- Reconhece automaticamente:
  - Capítulos e seções pelo padrão `NÚMERO. TÍTULO` / `NÚMERO.NÚMERO Título` (estilo
    "Título 1" do Word, em qualquer nível);
  - Tabelas normais (viram tabelas no site);
  - Caixas de aviso do Word (uma tabela com célula única) viram os destaques coloridos
    do site (azul para nota, vermelho para crítico/atenção — detectado automaticamente
    pela palavra "CRÍTICA" ou "ATENÇÃO" no início do texto).

## Testando localmente antes de publicar

Se quiser conferir como ficou antes de publicar, com Python instalado:

```bash
cd pasta-do-repositorio
python3 -m http.server 8000
```

E abra `http://localhost:8000` no navegador.
