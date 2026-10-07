# Plugin "Anuncie com Pix"

O anunciante preenche o formulário, sobe as fotos, paga o Pix e o anúncio **publica sozinho** quando o pagamento cai. Cobrança pelo [Asaas](https://www.asaas.com/).

Instalar por **Plugins → Adicionar novo → Enviar plugin**, enviando `anuncie-pix.zip`. Configurar em **Configurações → Anuncie com Pix**.

---

## ⚠️ Antes de ligar em produção: confira a API

Os endpoints, os nomes de campo e os valores de status do Asaas estão **todos em `inc/asaas.php`**, entre marcadores `CONFERIR`. Eles foram escritos **sem acesso à documentação do Asaas** — o ambiente onde este plugin foi gerado não alcança `docs.asaas.com`.

Confira os quatro pontos em `docs.asaas.com` ou no painel (**Integrações → API**):

| # | O que conferir | O que está no código |
|---|---|---|
| 1 | URL base do sandbox | `https://api-sandbox.asaas.com/v3` — existiu também `https://sandbox.asaas.com/api/v3`. Se o primeiro teste der 404, é a outra. |
| 2 | Nome do cabeçalho da chave | `access_token` |
| 3 | Caminho do QR Code Pix | `GET /payments/{id}/pixQrCode`, devolvendo `encodedImage` e `payload` |
| 4 | Status que contam como pago | `RECEIVED`, `CONFIRMED`, `RECEIVED_IN_CASH` |

Código de pagamento escrito de memória e conferido depois não é código pronto — é rascunho que parece pronto. **Rode o fluxo inteiro em sandbox antes de trocar o ambiente.**

---

## Como o fluxo funciona

1. O anunciante abre a página com o shortcode `[anunciar]`.
2. Preenche, sobe as fotos, declara ser maior de 18 e envia.
3. O plugin cria o anúncio como **rascunho**. Nunca publicado nesta etapa.
4. Cria o cliente e a cobrança Pix no Asaas e mostra o QR Code + copia e cola.
5. O Pix cai. O Asaas chama o webhook.
6. **O webhook não acredita no que recebeu**: consulta a cobrança na API do Asaas e só publica se a própria Asaas disser que foi paga.
7. Um agendamento de hora em hora despublica o que venceu, apaga os rascunhos que nunca pagaram (com as fotos) e **resgata o Pix que caiu sem o webhook chegar**.

## Instalação, passo a passo

### 1. A chave da API vai no `wp-config.php`, não no painel

```php
define('APIX_ASAAS_CHAVE', 'sua_chave_aqui');
```

Acima da linha `That's all, stop editing`. A constante tem prioridade sobre o campo do painel. **Chave no banco vai para dentro de todo backup e de todo dump de banco** — e chave de cobrança vazada é dinheiro saindo da sua conta.

### 2. Webhook no Asaas

Em **Integrações → Webhooks**, cadastre o que o painel do plugin mostra:

- **URL:** `https://seusite.com.br/wp-json/anuncie/v1/asaas`
- **Token:** sorteado na ativação, visível no painel
- **Eventos:** `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`

Se o webhook falhar, não é grave: de hora em hora o plugin confere na API os pendentes das últimas 72 horas e publica o que já foi pago.

### 3. A página do formulário

Crie uma página (ex. `/anunciar/`) e coloque `[anunciar]` nela. A mesma página mostra o QR Code depois do envio — não precisa de página de obrigado.

### 4. Planos

Os valores que vêm instalados (R$ 49,90 / 89,90 / 149,90) são **exemplo**. Troque pelos seus no painel. Não invento preço de serviço de ninguém.

---

## Área do anunciante (`[minha-area]`)

Crie uma segunda página (ex. `/minha-area/`) com o shortcode `[minha-area]`. De lá o anunciante edita o texto, troca as fotos e renova o plano sem passar por você.

### Login sem senha e sem usuário do WordPress

O anunciante digita o e-mail e recebe um link de uso único, válido por 30 minutos. Depois fica com uma sessão em cookie assinado por 7 dias. **Não cria usuário do WordPress** — deliberado, por três motivos:

1. Usuário tem *capability*, e capability se escala. Um bug em qualquer plugin instalado que vaze privilégio passa a valer para centenas de anunciantes que você não conhece.
2. Senha de terceiro é suporte eterno (esqueci, não chegou o e-mail, mudei de telefone) e senha fraca vira porta de entrada no site.
3. `/wp-login.php` com centenas de contas é alvo. Sem contas, não há o que adivinhar.

Quem tem o e-mail tem o anúncio — exatamente a mesma garantia de um "esqueci minha senha", sem a senha no meio.

### O formulário de acesso não entrega quem anuncia aqui

A resposta é **sempre idêntica**: *"Se existir anúncio com esse e-mail, o link acaba de ser enviado."* Vale para e-mail que existe, que não existe e que é inválido. Responder "não encontramos esse e-mail" transformaria o formulário numa consulta: bastaria testar uma lista para descobrir quem anuncia no site. Isso está coberto por teste.

O pedido de link é freado **por IP e pelo próprio e-mail**. Só por IP, uma botnet pediria mil links para o mesmo endereço, encheria a caixa de alguém no seu nome — e o seu domínio é que ganharia reputação de spam.

O token é guardado pelo **hash**: um dump da `wp_options` não entrega links vivos. E serve **uma vez só**, apagado antes de qualquer outra coisa — link reenviado, ou que vazou no histórico do navegador, não serve de novo. Depois do uso o token sai da URL por redirect, para não ficar no histórico, no `Referer` nem no log do servidor.

### O que uma edição pode fazer com um anúncio no ar

Este é o ponto delicado. Quem paga R$ 49 e ganha o direito de editar uma página publicada do seu site pode, depois de aprovado, trocar o texto por qualquer coisa. Num site deste ramo isso não é hipótese remota — e **o que aparece na página é sua responsabilidade, não da pessoa que anunciou**.

A solução não castiga o anunciante. Com **Conferir alterações** ligado (padrão):

| O que muda | Quando vale |
|---|---|
| Telefone e WhatsApp | **na hora** — é dado de contato, não conteúdo |
| Apagar foto | **na hora** — tirar do ar nunca é o risco; o risco é colocar |
| Trocar a capa | **na hora** |
| Texto e nome | depois da sua liberação |
| Fotos novas | depois da sua liberação |

**O anúncio nunca sai do ar esperando.** A alteração fica guardada em meta e a página segue com o conteúdo anterior — ninguém fica sem anúncio porque você foi dormir. As fotos novas ficam **soltas do post, sem pai**, para que nenhuma galeria do tema que lista filhos mostre foto não conferida; seria análise no papel e publicação na prática. Isso está coberto por teste.

Você libera pelo aviso no topo do admin ou pela caixa *Alteração do anunciante* dentro do anúncio, que mostra o antes e o depois lado a lado. **Recusar** descarta a alteração e apaga as fotos novas, sem tocar no anúncio.

Desligando a opção, tudo vai ao ar na hora. A escolha é sua; o padrão é conferir, e você recebe e-mail a cada edição nos dois casos.

### Renovação

O anunciante escolhe o plano e paga outro Pix. A renovação **soma ao prazo que resta**: quem renova com 5 dias sobrando fica com 35, não com 30 — ninguém é punido por pagar adiantado. Quem renova depois de vencer parte de hoje, porque prazo vencido não volta, e o anúncio sobe de novo. Ambos cobertos por teste.

O webhook aceita tanto a cobrança da primeira compra quanto a da renovação, e distingue as duas: renovação soma prazo, primeira compra publica. A rede de segurança horária também cobre renovação — `apix_confere_pendentes()` só olha rascunho, e anúncio renovado já está publicado, então sem uma checagem própria uma renovação cujo webhook se perdeu sumiria em silêncio.

---

## Lembrete de vencimento

### Por e-mail: automático

Marcos configuráveis **antes** (padrão `7, 3, 1` dias) e **depois** do vencimento (padrão `2` dias). O aviso de depois é o que mais converte: o anúncio saiu do ar e a pessoa sentiu a falta. Passado o último marco, o plugin para de insistir.

Sai **um e-mail por marco, nunca dois no mesmo dia**. Se o site ficar fora do ar e voltar com três marcos vencidos, vai só o mais urgente, e os outros são marcados como entregues — três e-mails seguidos é a melhor forma de cair no spam. A decisão fica numa função pura, `apix_marco_lembrete()`, com 18 asserções em cima dela.

Renovar **zera os marcos**, senão quem renovou nunca mais seria avisado: os marcos do ciclo anterior ficariam marcados como enviados para sempre.

Marcadores para o assunto e o corpo: `{anuncio}` `{dias}` `{plano}` `{valor}` `{link}` `{site}`. O `{dias}` sai sempre positivo — "vence em -3 dias" não se escreve.

### Por WhatsApp: um clique, em **Anúncios → Vencimentos**

A tela lista quem está vencendo com a mensagem já escrita e um botão por anunciante. O clique abre o WhatsApp com o texto pronto e você aperta enviar.

Não é automático. **E automático, de forma fácil, não existe** — vale saber por quê antes de procurar:

| Caminho | O que custa de verdade |
|---|---|
| **Cloud API da Meta** (oficial) | Conta Meta Business, **empresa verificada**, um número **dedicado** (não serve o que você já usa no WhatsApp), e modelo de mensagem **aprovado pela Meta** antes de qualquer envio fora da janela de 24h. A verificação leva dias. E a política de mensagens da Meta restringe conteúdo adulto — confira com cuidado antes de investir tempo, porque a conta pode cair depois de tudo pronto. |
| **Baileys / whatsapp-web.js** e similares | Viola os termos, o número é banido com frequência, e precisa de um processo Node rodando sempre — hospedagem compartilhada de WordPress não tem isso. |
| **Revenda de gateway** | As baratas são a linha de cima embrulhada, com o mesmo risco de banimento só que no número do cliente. As oficiais são a Cloud API com mensalidade. |

O botão resolve sem nada disso: sai do **seu** número (que o anunciante reconhece), não custa nada, não precisa de aprovação e não tem risco de banimento. São dois segundos por anunciante.

> Não consegui verificar as regras atuais da Meta online — o ambiente onde este plugin foi gerado não alcança sites externos. Confira a política de mensagens do WhatsApp Business antes de contar com o caminho oficial.

Se um dia você quiser o envio automático, **o único lugar a mexer é `apix_whats_url()`**. Quem avisar, quando, com que texto e o controle de repetição já estão prontos e valem para os dois caminhos.

---

## Segurança do upload

Você escolheu permitir upload **antes** do pagamento. É o cenário mais cômodo para o anunciante e o pior para o servidor: qualquer pessoa na internet grava arquivo no seu site sem se identificar e sem pagar nada. As cinco camadas, e o que cada uma de fato resolve:

| Camada | O que faz | O que ela realmente barra |
|---|---|---|
| 1 | Extensão na lista branca | o ingênuo, e só ele |
| 2 | Tipo real pelo `finfo`, lendo os bytes | `$_FILES['type']` vem do navegador, quem envia escolhe o que escrever ali |
| 3 | `getimagesize()` tem de devolver dimensão | arquivo que não é imagem de verdade |
| 4 | **Reempacotamento pelo GD** | **é esta que protege** — ver abaixo |
| 5 | `.htaccess` negando execução na pasta | rede de segurança se o servidor executar PHP dentro de uploads |

### Por que a camada 4 é a que importa

Existe arquivo que é **JPEG válido e código PHP ao mesmo tempo** (*polyglot*). Ele passa pelas camadas 1, 2 e 3 sem esforço. A camada 4 decodifica a imagem para memória e grava de novo em JPEG: entra arquivo, sai pixel. Qualquer byte estranho fica para trás.

Isso está provado em teste, não suposto. O banco de teste monta um JPEG com `<?php system($_GET['cmd'])` grudado, confirma que ele **passa** pelo `getimagesize` e pelo `finfo` como `image/jpeg`, e depois confirma que o código **não existe** na saída reempacotada.

De brinde, o reempacotamento derruba o **EXIF** — que em foto de celular carrega coordenada de GPS. Num site deste ramo, publicar o endereço de casa de quem anuncia junto com a foto não é descuido pequeno.

### Se o servidor for Nginx

Nginx **ignora `.htaccess`**. A camada 5 não existe nele. Ponha no server block:

```nginx
location ~* ^/wp-content/uploads/anuncios/.*\.(php|phar|phtml|pl|py|cgi|sh)$ {
    deny all;
}
```

### Requisitos do PHP

**GD** e **fileinfo** são obrigatórias. Sem qualquer uma das duas o upload é recusado inteiro — não há modo degradado, porque modo degradado aqui significa aceitar arquivo sem conferir. O painel mostra o estado das duas.

---

## Decisões que não são à toa

- **O webhook consulta de volta.** Um webhook é uma URL pública: qualquer pessoa pode mandar `PAYMENT_RECEIVED` para ela. Se o plugin publicasse com base no corpo recebido, anúncio de graça seria uma linha de `curl`, e no painel ficaria idêntico a uma venda. O token no cabeçalho (comparado com `hash_equals`, não `==`) só evita o trabalho; o que protege é a consulta.
- **O webhook também confere se a cobrança bate com o anúncio.** Sem isso, uma cobrança de R$ 1 com `externalReference` apontando para outro anúncio publicaria o plano caro.
- **Publicação idempotente.** O Asaas manda `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` para a mesma cobrança, e reenvia quando não recebe `200`. Sem a trava, cada reenvio esticaria o prazo do plano.
- **Eventos que não interessam saem com `200`.** Devolver erro faz o Asaas reenviar o mesmo aviso por horas.
- **O token da URL não é o ID do post.** Com o ID na URL, trocar o número mostraria a cobrança de outro anunciante — com nome, CPF e telefone dentro.
- **O CPF não é guardado inteiro**, só os 4 últimos dígitos, o suficiente para conferir com o Asaas. O IP fica como hash. CPF completo no banco de um site de anúncio é risco sem retorno.
- **O limite por IP sobe antes de criar o rascunho**, não depois da cobrança. Se subisse depois, quem conseguisse fazer a cobrança falhar criaria rascunho e subiria foto sem limite.
- **O payload do Pix fica em meta.** Sem isso, cada recarregada da página era uma chamada à API — e o anunciante recarrega, esperando a confirmação. Várias abas estourariam o limite da conta, e aí nenhum anunciante conseguiria gerar cobrança.
- **A consulta de status do navegador lê o banco, não a API.** Uma aba aberta por uma hora faria 720 requisições.
- **Rascunho sem pagamento é apagado com as fotos** depois de 48h (configurável). Sem isso o site vira hospedagem de imagem de graça e o disco enche sem ninguém notar, porque rascunho não aparece no site.
- **Mensagem de erro neutra no formulário.** Dizer "a chave da API não está configurada" entrega a pilha do site para quem estiver olhando.
- **Declarações de 18+, de direito sobre as fotos e de termos**, com data, hora, hash do IP e user-agent registrados. Não é formalidade num site deste ramo.
- **O CPT só é registrado se não existir.** Dois registros do mesmo CPT com rótulos diferentes é briga silenciosa que termina em admin quebrado.
- **`show_in_rest` desligado** no CPT: o anúncio não precisa de API pública.
- **Desinstalar não apaga os anúncios nem as fotos.** São conteúdo pago. Perder o que o anunciante pagou porque alguém clicou em "Excluir" no plugin errado não se desfaz.

## Anti-footprint na rede

Antes de instalar no segundo site, renomeie o prefixo, a pasta, o `Plugin Name:` e **o namespace do REST** (`APIX_NS`, que aparece na URL do webhook e na consulta de status, visível no HTML):

```bash
sed -i 's/apix/xyz/g; s/APIX/XYZ/g; s#anuncie/v1#outro/v1#g' anuncie-pix.php inc/*.php uninstall.php
```

O `uninstall.php` tem os nomes das opções escritos à mão e o `uninstall.php` do upload usa `apix_config` literal — confira que o `sed` os pegou. O nome do cookie (`APIX_COOKIE`) e os shortcodes `[anunciar]` e `[minha-area]` também aparecem no HTML; troque os shortcodes se quiser trocar tudo.

## Empacotar

```bash
python3 empacota.py
```

## Testes

```bash
php teste.php            # 43 asserções
php teste-area.php       # 58 asserções
php teste-lembretes.php  # 54 asserções
```

155 asserções, sem WordPress, sem banco e sem rede. `teste-wp-falso.php` é um WordPress mínimo com armazenamento em memória de opções, transients, posts e meta — o suficiente para testar lógica que mexe em estado.

- **`teste.php`** — CPF/CNPJ pelo dígito verificador, carimbo assinado anti-robô, `.htaccess`, limites, e o reempacotamento contra um *polyglot* real.
- **`teste-lembretes.php`** — a regra dos marcos (inclusive o site que ficou fora do ar e voltou com três marcos vencidos de uma vez), a não repetição, o aviso depois de vencer, a normalização do telefone para o `wa.me`, os marcadores e a volta à estaca zero ao renovar.
- **`teste-area.php`** — cookie de sessão (hash trocado, prazo esticado, assinatura forjada, cookie vencido, lixo), dono do anúncio, link de uso único, **mensagem idêntica para e-mail que existe e que não existe**, freio de pedidos, liberação e recusa de alteração, foto em análise solta do post, e a soma de prazo na renovação nos dois casos.

## Pendente

- Envio automático por WhatsApp pela Cloud API da Meta, se a política aceitar o ramo do site (só `apix_whats_url()` muda).
- Boleto e cartão além do Pix (o Asaas suporta; é trocar o `billingType` e tratar o prazo de compensação, que no boleto são dias).

Cupom de desconto ficou **fora de escopo** por decisão do dono do site.
