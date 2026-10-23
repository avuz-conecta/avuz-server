# Perguntas para a ZapSign (19/10/2026)

Olá, equipe ZapSign!

Somos a Avuz. Integramos a ZapSign à nossa plataforma (Avuz Conecta / ConectaSign) via API v1, com uma subconta por cliente. Testamos no sandbox e ficaram algumas dúvidas antes de seguirmos.

**1. E-mails enviados por nós, em vez da ZapSign**
Pensamos em criar os documentos com `disable_signer_emails: true` e enviar nós mesmos os convites, com o `sign_url` de cada signatário, pelo nosso servidor de e-mail.
- Nosso contrato de parceiro permite isso? E permite que o convite não mostre a marca ZapSign?
- No sandbox, `disable_signer_emails: true` também desligou o e-mail de cópia assinada. Ele desliga mais algum e-mail: o convite do próximo grupo, o cancelamento ou o código de verificação por e-mail/SMS da assinatura "Digitar"?
- O relatório de assinaturas (trilha de auditoria) registra por qual canal o link chegou ao signatário? Enviar o link por conta própria muda alguma coisa na validade jurídica ou no relatório?
- Na LGPD, para as subcontas de parceiro, a ZapSign atua como operadora e nós como controladores? Existe um DPA (acordo de tratamento de dados) para assinarmos?

**2. Se continuarmos com os e-mails da ZapSign**
- **Remetente.** O corpo do e-mail diz "Sua assinatura foi solicitada por <e-mail do dono da conta>", mesmo enviando `brand_name` e `created_by`. O `created_by` é ignorado quando a pessoa não é usuária da conta. Dá para definir, por documento, o nome e o e-mail de quem solicitou? E o Reply-To? Hoje ambos são do dono da conta, e cada cliente tem vários usuários que enviam documentos.
- **Layout.** Dá para centralizar o logo (`brand_logo`) no e-mail e remover o rodapé "O que é a ZapSign?" na nossa conta de parceiro?
- **Mensagem personalizada.** Criamos o documento com o envio automático desligado, posicionamos os campos e depois liberamos o envio (atualização do signatário, ou `resend-notifications-bulk`). Nesse caso o `custom_message` não aparece no primeiro e-mail; só aparece quando a ZapSign envia o convite na criação. Existe uma forma de liberar o envio depois de posicionar os campos mantendo o `custom_message`? Ou de criar o documento já com os campos posicionados?

**3. Página após a assinatura**
Com o `redirect_link`, aparece o botão "Continuar", mas o botão "Acessar documentos assinados" (área da ZapSign) continua. Dá para escondê-lo na nossa conta de parceiro? Gerenciamos os documentos na nossa plataforma.

**4. Assinatura "Digitar" sem código por e-mail**
Com "Assinar com Digitar" ativo, a ZapSign sempre exige um código por e-mail ou SMS, mesmo quando criamos o signatário com `auth_mode: assinaturaTela`. Existe uma opção, por documento ou por signatário, de validar só o CPF do signatário, sem data de nascimento e sem o código? Seria parecido com a Clicksign. Se não houver, o `validate_cpf` substitui o código ou é somado a ele? Ele tem custo?

Obrigado!
Equipe Avuz
