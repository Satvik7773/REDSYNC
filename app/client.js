const net=require('net');
const client=net.connect({port : 6379,host :"127.0.0.1"},function()
{
    client.write("Ping");
    console.log("connected");
});

client.on('data',function(data)
{

   console.log(data.toString());
   client.end();
});
