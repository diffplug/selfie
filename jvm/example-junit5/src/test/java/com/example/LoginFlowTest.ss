╔═ loginFlow/1. not logged in ═╗
<html>
 <head></head>
 <body>
  <h1>Please login</h1>
  <form action="/login" method="post">
   <input type="text" name="email" placeholder="email"> <input type="submit" value="login">
  </form>
 </body>
</html>
╔═ loginFlow/1. not logged in[md] ═╗
Please login
╔═ loginFlow/1. not logged in[statusLine] ═╗
HTTP/1.1 200 OK
╔═ loginFlow/2. post login form ═╗
<html>
 <head></head>
 <body>
  <h1>Email sent!</h1>
  <p>Check your email for your login link.</p>
 </body>
</html>
╔═ loginFlow/2. post login form[md] ═╗
Email sent!

Check your email for your login link.
╔═ loginFlow/2. post login form[statusLine] ═╗
HTTP/1.1 200 OK
╔═ loginFlow/3. login email ═╗
Click <a href="https://www.example.com/login-confirm/erjchFY=">here</a> to login.
╔═ loginFlow/3. login email[md] ═╗
Click [here](https://www.example.com/login-confirm/erjchFY=) to login.
╔═ loginFlow/3. login email[metadata] ═╗
subject=Login to example.com
to=user@domain.com
from=team@example.com
╔═ loginFlow/4. open login email link ═╗
REDIRECT 302 Found to /
╔═ loginFlow/4. open login email link[cookies] ═╗
login=user@domain.com|JclThw==;Path=/
╔═ loginFlow/4. open login email link[md] ═╗
REDIRECT 302 Found to /
╔═ loginFlow/5. should be logged in ═╗
<html>
 <head></head>
 <body>
  <h1>Welcome back user@domain.com</h1>
 </body>
</html>
╔═ loginFlow/5. should be logged in[md] ═╗
Welcome back user@domain.com
╔═ loginFlow/5. should be logged in[statusLine] ═╗
HTTP/1.1 200 OK
╔═ loginFlow/6. bad signature should fail ═╗
<!doctype html>
<html>
 <head>
  <meta charset="utf-8">
  <style>
body {font-family: "open sans",sans-serif; margin-left: 20px;}
h1 {font-weight: 300; line-height: 44px; margin: 25px 0 0 0;}
h2 {font-size: 16px;font-weight: 300; line-height: 44px; margin: 0;}
footer {font-weight: 300; line-height: 44px; margin-top: 10px;}
hr {background-color: #f7f7f9;}
div.trace {border:1px solid #e1e1e8; background-color: #f7f7f9;}
p {padding-left: 20px;}
p.tab {padding-left: 40px;}
</style>
  <title>Unauthorized (401)</title>
 </head>
 <body>
  <h1>Unauthorized</h1>
  <hr>
  <h2>status code: 401</h2>
 </body>
</html>
╔═ loginFlow/6. bad signature should fail[md] ═╗
Unauthorized

status code: 401
╔═ loginFlow/6. bad signature should fail[statusLine] ═╗
HTTP/1.1 401 Unauthorized
╔═ [end of file] ═╗
