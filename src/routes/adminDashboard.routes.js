const express=require('express')
const router=express.Router()

const {
getAdminDashboardStatsHandler,
getAdminExtraStatsHandler

}=require('../controllers/adminDashboard.controller')


const {verifyToken}=require('../middlewares/auth')
const {isAdmin}=require('../middlewares/roles')



router.get(
'/mis-estadisticas',
verifyToken,
isAdmin,
getAdminDashboardStatsHandler
)



router.get(
'/extra-stats',
verifyToken,
isAdmin,
getAdminExtraStatsHandler
)



module.exports=router