const {
 getAdminDashboardStats,
 getAdminExtraStats
}=require('../queries/adminDashboard.queries')


const getAdminDashboardStatsHandler=async(req,res)=>{

 try{

 const stats=
 await getAdminDashboardStats()

 res.json({
 data:stats
 })

 }catch(error){

 console.error(error)

 res.status(500).json({
 error:'Error interno'
 })

 }

}



const getAdminExtraStatsHandler=async(req,res)=>{

try{

const stats=
await getAdminExtraStats()


res.json({
data:stats
})


}catch(error){

console.error(error)

res.status(500).json({
error:'Error interno'
})

}

}


module.exports={
getAdminDashboardStatsHandler,
getAdminExtraStatsHandler
}